import { generateText, ModelMessage, tool } from "ai";
import { complexModel } from "@agents/providers";
import { settingsService } from "@/services";
import log from "electron-log/main";
import { planInputSchema } from "./planner";
import type { UIPlanType, UIPlanTodo } from "./planner";
import { executeSubtasks } from "./action-executor";

const logger = log.scope("browser-action-task-executor");

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Build system prompt for subtask planning
 */
function buildSystemPrompt(
	currentTask: UIPlanTodo,
	taskPlan: UIPlanType,
	previousSubtaskPlan: UIPlanType | undefined,
): string {
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
- label: Brief action title (e.g., "Navigate to login page and locate login form")
- status: Always "pending"
- description: Clear instructions on what this subtask should accomplish

## Subtask Guidelines
- Group related actions together
- Browser and tab are always available. Do NOT plan setup tasks like "open browser" or "ensure tab is ready"
- Write instructional descriptions that guide the action-executor agent
- Do NOT break into atomic actions (click, type). That is for the action-executor agent
- Consider page state from previous subtasks when writing instructions`;

	// Build failure context if previous subtask plan exists and has failed tasks
	let failureContext = "";
	if (previousSubtaskPlan && previousSubtaskPlan.todos) {
		const failedSubtask = previousSubtaskPlan.todos.find(
			(s) => s.status === "cancelled",
		);
		if (failedSubtask) {
			failureContext = `

## Previous Attempt Failed
The previous attempt to accomplish this task failed. Here's what happened:

Full Previous Subtask Plan:
${JSON.stringify(previousSubtaskPlan, null, 2)}

Failed Subtask:
${JSON.stringify(failedSubtask, null, 2)}

## Your Responsibility
You MUST replan the subtasks for this task, taking into account:
1. What went wrong in the previous attempt
2. What subtasks succeeded and can be kept as-is
3. Alternative approaches that might work better for the failed subtask
4. Whether you need to break down the task differently
5. Whether some steps need to be combined or split differently

Do NOT simply repeat the same plan. Adjust your approach based on the failure, but keep successful subtasks that still make sense.`;
		}
	}

	return `You are a browser automation subtask planner. Break down one high-level task into instructional subtasks.

## Current Task
${JSON.stringify(currentTask, null, 2)}${failureContext}

## Overall Plan Context
${JSON.stringify(taskPlan, null, 2)}${baseInstructions}

Now create the subtask plan for this task.`;
}

// ============================================================================
// Tool Definition
// ============================================================================

const generateSubtaskPlanTool = tool({
	description: "Generate a subtask execution plan for the current task",
	inputSchema: planInputSchema,
	execute: async (input, { experimental_context }) => {
		const context = experimental_context as {
			sessionId: string;
			subtaskPlan: GenerateSubtaskPlanToolResult | null;
		};
		// Populate todo ids
		const todosWithIds = input.todos.map((todo, index) => ({
			...todo,
			id: `subtask-${context.sessionId}-${index}`,
		}));
		// Populate subtask plan id and maxVisibleTodos
		const subtaskPlan: GenerateSubtaskPlanToolResult = {
			...input,
			id: `subtask-plan-${context.sessionId}`,
			maxVisibleTodos: 4,
			todos: todosWithIds,
		};
		// Store the subtask plan in context
		context.subtaskPlan = subtaskPlan;
		// Return populated subtask plan
		return subtaskPlan;
	},
});

type GenerateSubtaskPlanToolResult = UIPlanType;

// ============================================================================
// Main Exported Function
// ============================================================================

/**
 * Browser Use Task Executor
 *
 * Expands a high-level task into subtasks and executes them.
 * Manages task completion, workflow progression, and failure handling.
 *
 * @param messages - The conversation messages
 * @param sessionId - The current session ID
 * @param plan - The high-level task plan from the planner
 * @param currentTaskIndex - Index of the current task to expand (-1 if no active task)
 * @param previousSubtaskPlan - Optional previous subtask plan for failure context
 * @returns Executed subtask plan (modified in-place during execution)
 */
export async function browserUseTaskExecutor(
	messages: ModelMessage[],
	sessionId: string,
	plan: UIPlanType,
	currentTaskIndex: number,
	previousSubtaskPlan?: UIPlanType,
): Promise<UIPlanType> {
	logger.debug("Starting task executor", {
		sessionId,
		currentTaskIndex,
		taskCount: plan.todos.length,
	});

	// ============================================================================
	// Phase 1: Complete current task if all subtasks done
	// ============================================================================
	let workingIndex = currentTaskIndex;

	if (
		currentTaskIndex !== -1 &&
		previousSubtaskPlan &&
		previousSubtaskPlan.todos &&
		previousSubtaskPlan.todos.length > 0 &&
		previousSubtaskPlan.todos.every((subtask) => subtask.status === "completed")
	) {
		// Complete the current task and get the next index
		plan.todos[currentTaskIndex].status = "completed";
		workingIndex = currentTaskIndex + 1;

		logger.debug("Task completed, moving to next", {
			completedIndex: currentTaskIndex,
			nextIndex: workingIndex,
		});
	}

	// ============================================================================
	// Phase 2: Check if workflow is complete after task completion
	// ============================================================================
	if (
		(!plan || !plan.todos || plan.todos.every((todo) => todo.status === "completed")) ||
		workingIndex === -1 ||
		workingIndex >= plan.todos.length
	) {
		logger.info("Workflow completed successfully", {
			totalTasks: plan.todos.length,
		});

		return {
			id: "",
			title: "",
			todos: [],
		};
	}

	// ============================================================================
	// Phase 3: At this point, workingIndex is guaranteed to be a valid task index
	// Set current task to in_progress
	// ============================================================================
	plan.todos[workingIndex].status = "in_progress";

	// Build prompt
	const currentTask = plan.todos[workingIndex];
	const systemPrompt = buildSystemPrompt(
		currentTask,
		plan,
		previousSubtaskPlan,
	);

	logger.debug("Generating subtask plan", {
		currentTaskLabel: currentTask.label,
		hasPreviousSubtaskPlan: !!previousSubtaskPlan,
	});

	// ============================================================================
	// Phase 4: Generate new subtask plan using AI SDK
	// ============================================================================
	const context = {
		sessionId,
		subtaskPlan: null as GenerateSubtaskPlanToolResult | null,
	};

	const result = await generateText({
		model: complexModel(),
		messages,
		system: systemPrompt,
		tools: {
			generateSubtaskPlan: generateSubtaskPlanTool,
		},
		experimental_context: context,
		experimental_telemetry: {
			isEnabled: settingsService.settings.langfuse.enabled,
			functionId: "browser-action-task-executor",
			metadata: {
				langfuseTraceId: sessionId,
				currentTaskIndex: workingIndex,
				currentTaskLabel: currentTask.label,
			},
		},
	});

	// Extract subtask plan from tool results
	const allToolResults = result.steps.flatMap((step) => step.toolResults ?? []);
	const subtaskPlanResult = allToolResults.find(
		(toolResult) => toolResult.toolName === "generateSubtaskPlan",
	)?.output as GenerateSubtaskPlanToolResult | undefined;

	if (!subtaskPlanResult) {
		logger.error("Failed to generate subtask plan: tool not called");
		throw new Error(
			"Failed to generate subtask plan: generateSubtaskPlan tool not called",
		);
	}

	logger.info("Subtask plan generated successfully", {
		title: subtaskPlanResult.title,
		todoCount: subtaskPlanResult.todos.length,
	});

	// ============================================================================
	// Phase 5: Execute subtasks
	// ============================================================================
	logger.debug("Starting subtask execution", {
		subtaskCount: subtaskPlanResult.todos.length,
	});

	const allSuccessful = await executeSubtasks(
		subtaskPlanResult, // Modified in-place during execution
		sessionId,
		messages,
	);

	if (allSuccessful) {
		logger.info("All subtasks completed successfully", {
			subtaskCount: subtaskPlanResult.todos.length,
		});
	} else {
		logger.info("Some subtasks failed, returning for replanning", {
			subtaskCount: subtaskPlanResult.todos.length,
			failedCount: subtaskPlanResult.todos.filter(
				(t) => t.status === "cancelled",
			).length,
		});
	}

	// ============================================================================
	// Phase 6: Return executed subtask plan
	// ============================================================================
	return subtaskPlanResult;
}
