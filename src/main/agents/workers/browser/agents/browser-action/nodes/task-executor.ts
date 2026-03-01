import { SystemMessage } from "@langchain/core/messages";
import {
	BrowserActionStateType,
	PlanSchema,
	Plan,
	PlanItemSchema,
} from "../state";
import { complexLangchainModel } from "@/agents/providers";
import { createAgent, toolStrategy } from "langchain";
import { Command, END } from "@langchain/langgraph";
import { z } from "zod";

type PlanItem = z.infer<typeof PlanItemSchema>;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if all tasks in the plan are completed
 */
function areAllTasksCompleted(taskPlan: Plan | undefined): boolean {
	return !taskPlan || taskPlan.every((task) => task.status === "completed");
}

/**
 * Check if all subtasks of current task are completed
 */
function areAllSubtasksCompleted(subtaskPlan: Plan | undefined): boolean {
	return Boolean(
		subtaskPlan &&
		subtaskPlan.length > 0 &&
		subtaskPlan.every((subtask) => subtask.status === "completed"),
	);
}

/**
 * Mark the current task as completed and return updated state with next index
 * Returns the next task index (current + 1)
 */
function completeCurrentTask(
	state: BrowserActionStateType,
	taskIndex: number,
): { state: BrowserActionStateType; nextIndex: number } {
	const updatedTaskPlan = [...state.task_plan];
	updatedTaskPlan[taskIndex] = {
		...updatedTaskPlan[taskIndex],
		status: "completed",
	};
	return {
		state: {
			...state,
			task_plan: updatedTaskPlan,
		},
		nextIndex: taskIndex + 1,
	};
}

/**
 * Set the current task status to in_progress and return updated state
 */
function setCurrentTaskInProgress(
	state: BrowserActionStateType,
	taskIndex: number,
): BrowserActionStateType {
	const updatedTaskPlan = [...state.task_plan];
	updatedTaskPlan[taskIndex] = {
		...updatedTaskPlan[taskIndex],
		status: "in_progress",
	};
	return {
		...state,
		task_plan: updatedTaskPlan,
	};
}

/**
 * Build failure context for the system prompt
 */
function buildFailureContext(subtaskPlan: Plan | undefined): string {
	if (!subtaskPlan) return "";

	const failedSubtask = subtaskPlan.find((s) => s.status === "failed");
	if (!failedSubtask) return "";

	return `

## Previous Attempt Failed
The previous attempt to accomplish this task failed. Here's what happened:

Full Previous Subtask Plan:
${JSON.stringify(subtaskPlan, null, 2)}

Failed Subtask:
${JSON.stringify(failedSubtask, null, 2)}

Failure Explanation:
${
	failedSubtask.results?.[failedSubtask.results.length - 1] ||
	"No explanation provided"
}

## Your Responsibility
You MUST replan the subtasks for this task, taking into account:
1. What went wrong in the previous attempt
2. What subtasks succeeded and can be kept as-is
3. Alternative approaches that might work better for the failed subtask
4. Whether you need to break down the task differently
5. Whether some steps need to be combined or split differently

Do NOT simply repeat the same plan. Adjust your approach based on the failure, but keep successful subtasks that still make sense.`;
}

/**
 * Build system prompt for subtask planning
 */
function buildSystemPrompt(
	currentTask: PlanItem,
	taskPlan: Plan,
	failureContext: string,
): SystemMessage {
	const baseInstructions = `

## Your Responsibilities
Expand the current task into subtasks that provide clear instructions for the next subagent.

## Example
If the current task is "Log in to current site", you might create:
1. "Locate and navigate to the login portal/page"
2. "Find the username and password input fields on the page"
3. "Fill in the username and password credentials. If username and password are on different pages, submit the first page and fill in credentials on each page separately"
4. "Submit all information and complete the login process"

## Subtask Schema
Each subtask has:
- id: String number ('1', '2', '3'...) incrementing from '1'
- label: Brief action title (e.g., "Navigate to login page and locate login form")
- description: Clear instructions on what this subtask should accomplish

## Subtask Guidelines
- Group related actions together
- Browser and tab are always available. Do NOT plan setup tasks like "open browser" or "ensure tab is ready"
- Write instructional descriptions that guide the action-executor agent
- Do NOT break into atomic actions (click, type). That is for the action-executor agent
- Consider page state from previous subtasks when writing instructions`;

	return new SystemMessage(
		`You are a browser automation subtask planner. Break down one high-level task into instructional subtasks.

## Current Task
${JSON.stringify(currentTask, null, 2)}${failureContext}

## Overall Plan Context
${JSON.stringify(taskPlan, null, 2)}${baseInstructions}

Now create the subtask plan for this task.`,
	);
}

/**
 * Generate subtask plan using AI agent
 */
async function generateSubtaskPlan(
	systemPrompt: SystemMessage,
	messages: BrowserActionStateType["messages"],
): Promise<{ subtask_plan: Plan }> {
	const agent = createAgent({
		model: complexLangchainModel(),
		responseFormat: toolStrategy(z.object({ subtask_plan: PlanSchema })),
		systemPrompt,
	});

	const response = await agent.invoke({ messages });
	return response.structuredResponse as { subtask_plan: Plan };
}

// ============================================================================
// Main Node Function
// ============================================================================

export async function browserActionTaskExecutorNode(
	state: BrowserActionStateType,
): Promise<Command> {
	// Phase 1: Complete current task if all subtasks done
	let workingState: BrowserActionStateType = state;
	let currentIndex: number = state.current_task_index ?? -1;

	if (
		state.current_task_index !== -1 &&
		areAllSubtasksCompleted(state.subtask_plan)
	) {
		// Complete the current task and get the next index
		const result = completeCurrentTask(state, state.current_task_index);
		workingState = result.state;
		currentIndex = result.nextIndex;

		// Reset subtask index when moving to next task
		workingState = {
			...workingState,
			current_subtask_index: 0,
		};
	}

	// Phase 2: Check if workflow is complete after task completion
	if (
		areAllTasksCompleted(workingState.task_plan) ||
		currentIndex === -1 ||
		currentIndex >= workingState.task_plan.length
	) {
		return new Command({
			update: {
				task_plan: workingState.task_plan,
				subtask_plan: [],
				// Reset indices when workflow completes
				current_task_index: -1,
				current_subtask_index: -1,
			},
			goto: END,
		});
	}

	// Phase 3: At this point, currentIndex is guaranteed to be a valid task index
	// Set current task to in_progress
	workingState = setCurrentTaskInProgress(workingState, currentIndex);

	// Build prompt
	const currentTask = workingState.task_plan[currentIndex];
	const failureContext = buildFailureContext(workingState.subtask_plan);
	const systemPrompt = buildSystemPrompt(
		currentTask,
		workingState.task_plan,
		failureContext,
	);

	// Phase 5: Generate new subtask plan
	const response = await generateSubtaskPlan(
		systemPrompt,
		workingState.messages,
	);

	// Phase 6: Return command with explicit index management
	return new Command({
		update: {
			// Set to the index we're working on
			current_task_index: currentIndex,
			// Set subtask index to start at 0
			current_subtask_index: 0,
			...response,
		},
		goto: "action-executor",
	});
}
