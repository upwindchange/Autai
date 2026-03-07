import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { BrowserActionStateType, PlanSchema } from "../state";
import { complexLangchainModel } from "@/agents/providers";
import { createAgent, toolStrategy, humanInTheLoopMiddleware } from "langchain";
import { Command } from "@langchain/langgraph";
import { LangGraphRunnableConfig } from "@langchain/langgraph";
import z from "zod";
import { retryMiddleware } from "@agents/utils";
import {
	convertPlanToUiTool,
	awaitPlanApprovalTool,
} from "@agents/utils/planConverterTool";
import log from "electron-log/main";

const logger = log.scope("Planner");

export async function browserActionPlannerNode(
	state: BrowserActionStateType,
): Promise<Command> {
	// ============================================================================
	// Phase 1: Generate Plan (Structured Output, No Tools)
	// ============================================================================

	const planSystemPrompt = new SystemMessage(
		`You are a browser automation planner. Break down the user's request into logical high-level tasks.

## Your Capabilities
You can control browsers: navigate, interact with pages, fill forms, extract information, and coordinate multi-page workflows.

## Planning Strategy
1. Understand what the user wants to accomplish
2. Identify the logical flow - what must happen first, then next
3. Break into 3-10 major tasks that represent coherent phases

## Important
- Each task will be expanded into subtasks by another AI
- Think at the "what" level, not "how"
- Example: "Log in to the site" is ONE task. Another AI will expand it to: find login form → enter username → enter password → submit
- If complex, break into more tasks rather than fewer

## Task Schema
Each task has:
- id: String number ('1', '2', '3'...) incrementing from '1'
- label: Brief action title (e.g., "Find and navigate to login page")
- status: Always "pending"
- description: What this task accomplishes and why it's necessary

Now create the execution plan.`,
	);

	const planAgent = createAgent({
		model: complexLangchainModel(),
		responseFormat: toolStrategy(z.object({ task_plan: PlanSchema })),
		systemPrompt: planSystemPrompt,
		middleware: retryMiddleware,
	});

	const planResponse = await planAgent.invoke({
		messages: state.messages,
	});

	logger.log(planResponse);
	// Extract task_plan from structured response
	const { task_plan } = planResponse.structuredResponse;

	// ============================================================================
	// Phase 2: Display Plan + Wait for Approval (Tools + HITL)
	// ============================================================================

	const approvalSystemPrompt = new SystemMessage(
		`You are an approval coordinator. Your job is to:
	1. Display the generated plan to the user
	2. Wait for their approval before proceeding

	You MUST call tools in this exact order:
	1. FIRST: Call showPlan with the task_plan as input (from the previous message)
	2. SECOND: Call awaitPlanApproval to wait for human approval

	Do NOT skip these steps.`,
	);

	const approvalAgent = createAgent({
		model: complexLangchainModel(),
		tools: [convertPlanToUiTool, awaitPlanApprovalTool],
		systemPrompt: approvalSystemPrompt,
		middleware: [
			humanInTheLoopMiddleware({
				interruptOn: {
					awaitPlanApproval: {
						allowedDecisions: ["approve", "reject"],
						description:
							"Review the browser automation plan above before proceeding",
					},
				},
			}),
		],
	});
	const planMessage = new HumanMessage(JSON.stringify({ task_plan }));
	// Invoke approval agent with plan in messages
	await approvalAgent.invoke({
		messages: [planMessage],
	});

	return new Command({
		update: {
			task_plan,
			current_task_index: 0,
			current_subtask_index: 0,
		},
		goto: "task-executor",
	});
}
