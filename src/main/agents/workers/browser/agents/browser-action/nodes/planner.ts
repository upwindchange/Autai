import { SystemMessage } from "@langchain/core/messages";
import { BrowserActionStateType, PlanSchema } from "../state";
import { complexLangchainModel } from "@/agents/providers";
import { createAgent, toolStrategy } from "langchain";
import { Command } from "@langchain/langgraph";
import z from "zod";

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

## Task Schema
Each task has:
- id: String number ('1', '2', '3'...) incrementing from '1'
- label: Brief action title (e.g., "Find and navigate to login page")
- status: Always "pending"
- description: What this task accomplishes and why it's necessary

Now create the execution plan.`,
	);

	const agent = createAgent({
		model: complexLangchainModel(),
		responseFormat: toolStrategy(z.object({ task_plan: PlanSchema })),
		systemPrompt,
	});

	const response = await agent.invoke({ messages: state.messages });
	return new Command({
		update: {
			...response.structuredResponse,
			// Initialize to first task (index 0)
			current_task_index: 0,
			current_subtask_index: 0,
		},
		goto: "task-executor",
	});
}
