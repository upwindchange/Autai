import { SystemMessage, ToolMessage } from "@langchain/core/messages";
import { BrowserActionStateType, PlanSchema, Plan } from "../state";
import { complexLangchainModel } from "@/agents/providers";
import { createAgent, toolStrategy } from "langchain";
import { Command, END } from "@langchain/langgraph";
import z from "zod";
import { retryMiddleware } from "@agents/utils";
import log from "electron-log/main";
import { showPlanTool } from "@/agents/tools/PlanTool";

const logger = log.scope("Planner");

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Strip the results field from plan todos for cleaner display during approval.
 * Results are added during execution and should not be shown in the approval UI.
 */
function stripResults(plan: Plan): Plan {
	return {
		...plan,
		todos: plan.todos.map((todo) => {
			const { results: _results, ...rest } = todo;
			return rest;
		}),
	};
}

export async function browserActionPlannerNode(
	state: BrowserActionStateType,
): Promise<Command> {
	const systemPrompt = new SystemMessage(
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

## Plan Format
Generate a plan with:
- id: "plan-${state.sessionId}"
- title: Brief title for the entire plan
- description: What this plan accomplishes
- todos: Array of tasks, each with id ('1', '2', '3'...), label, status ('pending'), and description
- maxVisibleTodos: Optional (default 4)

Now create the execution plan.`,
	);

	const agent = createAgent({
		model: complexLangchainModel(),
		responseFormat: toolStrategy(z.object({ task_plan: PlanSchema })),
		systemPrompt,
		middleware: retryMiddleware,
	});

	const response = await agent.invoke({ messages: state.messages });

	// Extract the plan from structured response - already in correct format
	const { task_plan } = response.structuredResponse;

	logger.info("Plan generated, requesting human approval", {
		planId: task_plan.id,
		taskCount: task_plan.todos.length,
	});

	// Create tool message for logging
	const toolMessage = new ToolMessage({
		content: JSON.stringify(task_plan, null, 2),
		tool_call_id: `plan-${Date.now()}`,
		name: "showPlan",
	});

	logger.info("Planner Tool Message:", {
		toolCallId: toolMessage.tool_call_id,
		content: toolMessage.content,
		name: toolMessage.name,
		planData: task_plan,
	});

	// Strip results field for cleaner display during approval
	const planForApproval = stripResults(task_plan);

	// Call showPlan tool which will interrupt and wait for human approval
	try {
		const approvedPlan = await showPlanTool.invoke(planForApproval);

		logger.info("Plan approved, proceeding to execution", {
			planId: approvedPlan.id,
			taskCount: approvedPlan.todos.length,
		});

		// Return command with approved plan and navigate to executor
		return new Command({
			update: {
				task_plan: approvedPlan,
				current_task_index: 0,
				current_subtask_index: 0,
			},
			goto: "task-executor",
		});
	} catch (error) {
		// Handle rejection - end workflow with error message
		const errorMessage =
			error instanceof Error ? error.message : "Plan rejected by user";

		logger.info("Plan rejected, ending workflow", {
			errorMessage,
			planId: task_plan.id,
		});

		return new Command({
			update: {
				response: errorMessage,
				task_plan,
			},
			goto: END,
		});
	}
}
