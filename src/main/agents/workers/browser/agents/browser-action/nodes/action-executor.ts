import { SystemMessage } from "@langchain/core/messages";
import { BrowserActionStateType } from "../state";
import { simpleLangchainModel } from "@/agents/providers";
import { createAgent, toolStrategy } from "langchain";
import { Command } from "@langchain/langgraph";
import { z } from "zod";
import { interactiveTools } from "@/agents/tools/InteractiveTools";
import { tabControlTools } from "@/agents/tools/TabControlTools";
import { getFlattenDOMTool } from "@/agents/tools/DOMTools";

export async function browserActionExecutorNode(
	state: BrowserActionStateType,
): Promise<Command> {
	// Find the first pending subtask
	const firstPendingSubtaskIndex = state.subtask_plan?.findIndex(
		(subtask) => subtask.status === "pending",
	);

	// If all subtasks are completed, route to task-executor for next task
	if (
		!state.subtask_plan ||
		firstPendingSubtaskIndex === undefined ||
		firstPendingSubtaskIndex === -1
	) {
		return new Command({
			update: {},
			goto: "task-executor",
		});
	}

	const currentSubtask = state.subtask_plan[firstPendingSubtaskIndex];

	// Build context
	const subtaskContext = JSON.stringify(currentSubtask, null, 2);
	const allSubtasksContext = JSON.stringify(state.subtask_plan, null, 2);

	const systemPrompt = new SystemMessage(
		`You are a browser automation action executor. Your role is to execute atomic, concrete browser actions to accomplish a subtask.

## Current Subtask
${subtaskContext}

## All Subtasks Context
${allSubtasksContext}

## Your Capabilities
You have access to tools for:
- Interactive elements: click, fill, select, hover, drag
- Page navigation: navigate, refresh, go back, go forward
- Page scrolling: scroll by pages or at coordinates
- DOM analysis: getFlattenDOMTool (LLM-optimized flattened DOM representation)
- Element inspection: get attributes, evaluate JavaScript, get basic info

## Your Responsibilities
1. Use getFlattenDOMTool FIRST to understand the current page state
2. Identify which atomic actions are needed to accomplish the subtask
3. Execute actions sequentially using appropriate tools
4. **CRITICAL:** After EVERY action, use getFlattenDOMTool to evaluate the result
5. Use BOTH getFlattenDOMTool result AND previous tool return value to judge success/failure
6. Continue executing actions until the subtask is fully accomplished
7. After all actions complete, update the subtask with success/fail status and explanation

## Execution Pattern
For each action:
1. Execute action tool (click, fill, navigate, etc.)
2. Call getFlattenDOMTool to see updated page state
3. Compare before/after DOM states
4. Analyze tool return value
5. Judge if action succeeded based on DOM changes + tool return
6. Continue to next action or retry if needed

## Success/Failure Judgment
Based on:
- getFlattenDOMTool result: Did the DOM change as expected?
- Tool return value: Did the tool report success?
- Current page state: Does it match expected outcome?

## Subtask Result
When subtask is completed:
- Set subtask_completed: true
- Set subtask_success: true if all actions succeeded, false if any failed
- Provide detailed result_explanation describing what was accomplished or why it failed

## Important
- Always use getFlattenDOMTool BEFORE the first action to understand initial state
- Always use getFlattenDOMTool AFTER EVERY action to evaluate results
- Use backendNodeId from DOM analysis to target specific elements
- Each action should move purposefully toward subtask completion
- If an action fails, explain why and either retry or mark subtask as failed
- Be thorough in your evaluation - use DOM state + tool return to judge success

Now execute the actions needed to accomplish this subtask.`,
	);

	// Combine all tools - getFlattenDOMTool first for priority
	const allTools = [
		getFlattenDOMTool,
		...interactiveTools,
		...tabControlTools,
	];

	const agent = createAgent({
		model: simpleLangchainModel,
		tools: allTools,
		responseFormat: toolStrategy(
			z.object({
				subtask_completed: z
					.boolean()
					.describe("Whether the current subtask has been fully accomplished"),
				subtask_success: z
					.boolean()
					.describe("Whether the subtask was completed successfully or failed"),
				actions_taken: z
					.array(z.string())
					.describe("List of actions executed (e.g., 'Clicked submit button', 'Filled email field')"),
				current_status: z
					.string()
					.describe("Brief description of the current page/state"),
				result_explanation: z
					.string()
					.describe("Explanation of success/failure based on getFlattenDOMTool result and previous tool call results"),
			}),
		),
		systemPrompt,
	});

	const response = await agent.invoke({ messages: state.messages });

	// Update subtask status based on success/failure
	const updatedSubtaskPlan = [...(state.subtask_plan || [])];
	updatedSubtaskPlan[firstPendingSubtaskIndex] = {
		...updatedSubtaskPlan[firstPendingSubtaskIndex],
		status: response.structuredResponse.subtask_success ? "completed" : "failed",
		results: [
			...(updatedSubtaskPlan[firstPendingSubtaskIndex].results || []),
			response.structuredResponse.result_explanation,
		],
	};

	// If subtask failed, route back to task-executor for replanning
	if (!response.structuredResponse.subtask_success) {
		return new Command({
			update: {
				current_subtask_index: firstPendingSubtaskIndex,
				subtask_plan: updatedSubtaskPlan,
				...response.structuredResponse,
			},
			goto: "task-executor", // Always go back on failure
		});
	}

	// If successful and more subtasks pending, continue executing
	// If all subtasks completed, go back to task-executor
	const hasMorePendingSubtasks = updatedSubtaskPlan.some(
		(subtask, idx) => idx > firstPendingSubtaskIndex && subtask.status === "pending",
	);

	return new Command({
		update: {
			current_subtask_index: firstPendingSubtaskIndex,
			subtask_plan: updatedSubtaskPlan,
			...response.structuredResponse,
		},
		goto: hasMorePendingSubtasks ? "action-executor" : "task-executor",
	});
}
