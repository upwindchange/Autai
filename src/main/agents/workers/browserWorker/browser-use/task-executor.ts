import {
	streamText,
	createUIMessageStream,
	ModelMessage,
	tool,
} from "ai";
import { complexModel } from "@agents/providers";
import { settingsService } from "@/services";
import { simulateToolCall } from "@agents/utils";
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
		const context = experimental_context as { sessionId: string };
		// Populate todo ids
		const todosWithIds = input.todos.map((todo, index) => ({
			...todo,
			id: `subtask-${context.sessionId}-${index}`,
		}));
		// Populate subtask plan id and maxVisibleTodos
		const subtaskPlan: UIPlanType = {
			...input,
			id: `subtaskplan-${context.sessionId}`,
			maxVisibleTodos: 4,
			todos: todosWithIds,
		};
		// Return populated subtask plan
		return subtaskPlan;
	},
});

// ============================================================================
// Main Exported Function
// ============================================================================

/**
 * Browser Use Task Executor
 *
 * Expands a high-level task into subtasks and executes them.
 * Only handles the current task - task completion and progression is managed by the worker.
 *
 * @param messages - The conversation messages
 * @param sessionId - The current session ID
 * @param plan - The high-level task plan from the planner
 * @param currentTaskIndex - Index of the current task to expand
 * @param previousSubtaskPlan - Optional previous subtask plan for failure context
 * @returns StreamTextResult that includes subtask planning and execution
 */
export async function browserUseTaskExecutor(
	messages: ModelMessage[],
	sessionId: string,
	plan: UIPlanType,
	currentTaskIndex: number,
	previousSubtaskPlan?: UIPlanType,
): Promise<ReturnType<typeof createUIMessageStream>> {
	logger.debug("Starting task executor", {
		sessionId,
		currentTaskIndex,
		taskCount: plan.todos.length,
	});

	// ============================================================================
	// Validate current task exists
	// ============================================================================
	if (
		!plan ||
		!plan.todos ||
		currentTaskIndex < 0 ||
		currentTaskIndex >= plan.todos.length
	) {
		logger.error("Invalid task index", {
			currentTaskIndex,
			taskCount: plan.todos?.length ?? 0,
		});
		throw new Error(
			`Invalid task index: ${currentTaskIndex}. Plan has ${plan.todos?.length ?? 0} tasks.`,
		);
	}

	// ============================================================================
	// Set current task to in_progress
	// ============================================================================
	plan.todos[currentTaskIndex].status = "in_progress";

	// Generate simulated tool call messages to trigger UI update
	const {
		assistantMessage: inProgressAssistantMsg,
		toolMessage: inProgressToolMsg,
	} = await simulateToolCall({
		toolName: "showPlan",
		input: {
			title: plan.title,
			todos: plan.todos,
		},
		output: plan, // The updated plan with status="in_progress"
	});

	// Inject simulated messages into conversation history for UI rendering
	messages.push(inProgressAssistantMsg, inProgressToolMsg);

	logger.debug("Simulated showPlan tool call for UI update", {
		taskId: plan.todos[currentTaskIndex].id,
		status: "in_progress",
	});

	// Build prompt
	const currentTask = plan.todos[currentTaskIndex];
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
	// Create a combined stream that includes subtask planning and execution
	// ============================================================================
	return createUIMessageStream({
		execute: async ({ writer }) => {
			const context = {
				sessionId,
			};

			// ============================================================================
			// Step 1: Generate subtask plan using AI SDK
			// ============================================================================
			const subtaskPlanResult = streamText({
				model: complexModel(),
				messages,
				system: systemPrompt,
				tools: {
					showPlan: generateSubtaskPlanTool,
				},
				experimental_context: context,
				experimental_telemetry: {
					isEnabled: settingsService.settings.langfuse.enabled,
					functionId: "browser-action-task-executor",
					metadata: {
						langfuseTraceId: sessionId,
						currentTaskIndex,
						currentTaskLabel: currentTask.label,
					},
				},
			});

			// Merge subtask planning stream
			writer.merge(
				subtaskPlanResult.toUIMessageStream({ sendStart: false }),
			);

			// Wait for subtask plan to complete and extract it
			await subtaskPlanResult.finishReason;
			const steps = await subtaskPlanResult.steps;
			const allToolResults = steps.flatMap(
				(step) => step.toolResults ?? [],
			);
			const subtaskPlanResultData = allToolResults.find(
				(toolResult) => toolResult.toolName === "showPlan",
			)?.output as UIPlanType | undefined;

			if (!subtaskPlanResultData) {
				logger.error("Failed to generate subtask plan: tool not called");
				throw new Error(
					"Failed to generate subtask plan: showPlan tool not called",
				);
			}

			logger.info("Subtask plan generated successfully", {
				title: subtaskPlanResultData.title,
				todoCount: subtaskPlanResultData.todos.length,
			});

			// ============================================================================
			// Step 2: Execute subtasks (streaming)
			// ============================================================================
			logger.debug("Starting subtask execution", {
				subtaskCount: subtaskPlanResultData.todos.length,
			});

			const actionExecutorStream = await executeSubtasks(
				subtaskPlanResultData, // Modified in-place during execution
				sessionId,
				messages,
			);

			// Merge action executor stream directly (it's already a ReadableStream)
			writer.merge(actionExecutorStream);

			// Wait for stream to complete by reading until done
			const reader = actionExecutorStream.getReader();
			while (true) {
				const { done } = await reader.read();
				if (done) break;
			}
			reader.releaseLock();

			logger.info("Subtask execution completed", {
				subtaskCount: subtaskPlanResultData.todos.length,
			});
		},
		onError: (error) => {
			logger.error("Error in task executor stream", {
				error,
				stack: error instanceof Error ? error.stack : undefined,
			});
			return error instanceof Error ? error.message : String(error);
		},
	});
}
