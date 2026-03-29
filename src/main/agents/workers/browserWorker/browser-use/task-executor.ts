import {
	streamText,
	createUIMessageStream,
	ModelMessage,
	tool,
	stepCountIs,
} from "ai";
import { complexModel } from "@agents/providers";
import { settingsService } from "@/services";
import { simulateToolCall, mergeStreamAndWait } from "@agents/utils";
import log from "electron-log/main";
import { planInputSchema } from "./planner";
import type { UIPlanType, UIPlanTodo } from "./planner";
import { executeSubtasks } from "./action-executor";
import { hasSuccessfulToolResult } from "@/agents/utils";

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

## Plan Schema
The showPlan tool expects a plan object with these REQUIRED fields:
- title: Short title for the subtask plan (e.g., "Subtask plan: Navigate to Google.com")
- description: Brief description of the subtask plan's overall goal
- todos: Array of subtask items (see below)

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
- Consider page state from previous subtasks when writing instructions

## Important
You MUST call the showPlan tool to provide your subtask plan. Do not just describe the plan in text — you are required to use the showPlan tool.`;

	// Build failure context from current task's receipt
	let failureContext = "";
	if (currentTask.receipt && currentTask.receipt.outcome !== "success") {
		failureContext = `

## Previous Attempt Failed
The previous attempt to accomplish this task failed. Here's what happened:

Task Receipt:
${JSON.stringify(currentTask.receipt, null, 2)}

## Your Responsibility
You MUST replan the subtasks for this task, taking into account:
1. What went wrong in the previous attempt
2. Alternative approaches that might work better
3. Whether you need to break down the task differently
4. Whether some steps need to be combined or split differently

Do NOT simply repeat the same plan. Adjust your approach based on the failure.`;
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
 * Handles task completion marking and automatic replanning on failures.
 *
 * @param messages - The conversation messages
 * @param sessionId - The current session ID
 * @param plan - The high-level task plan from the planner
 * @param currentTaskIndex - Index of the current task to expand
 * @param maxRetries - Maximum number of replanning attempts (default: 3)
 * @param attemptCount - Current retry attempt count (default: 0)
 * @returns StreamTextResult that includes subtask planning and execution
 */
export async function browserUseTaskExecutor(
	messages: ModelMessage[],
	sessionId: string,
	plan: UIPlanType,
	currentTaskIndex: number,
	maxRetries: number = 3,
	attemptCount: number = 0,
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
			description: plan.description,
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
	const systemPrompt = buildSystemPrompt(currentTask, plan);

	logger.debug("Generating subtask plan", {
		currentTaskLabel: currentTask.label,
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
				toolChoice: {
					type: "tool",
					toolName: "showPlan",
				},
				tools: {
					showPlan: generateSubtaskPlanTool,
				},
				experimental_context: context,
				stopWhen: [hasSuccessfulToolResult("showPlan"), stepCountIs(100)],
				experimental_telemetry: {
					isEnabled: settingsService.settings.langfuse.enabled,
					functionId: "browser-use-task-executor",
					metadata: {
						langfuseTraceId: sessionId,
						currentTaskIndex,
						currentTaskLabel: currentTask.label,
					},
				},
			});

			// Merge subtask planning stream
			writer.merge(subtaskPlanResult.toUIMessageStream({ sendStart: false }));

			// Wait for subtask plan to complete and extract it
			const finishReason = await subtaskPlanResult.finishReason;
			const steps = await subtaskPlanResult.steps;

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const anySteps = steps as any[];
			logger.info("Subtask plan stream finished", {
				finishReason,
				stepCount: steps.length,
				steps: anySteps.map((step, i) => ({
					index: i,
					toolCalls: (step.toolCalls ?? []).map((tc) => ({
						toolName: tc.toolName,
						args: tc.args,
					})),
					toolResults: (step.toolResults ?? []).map((tr) => ({
						type: tr.type,
						toolName: tr.toolName,
						hasOutput: tr.output != null,
						output: tr.output,
						error: tr.error,
					})),
				})),
			});

			const allToolResults = steps.flatMap((step) => step.toolResults ?? []);
			const subtaskPlanResultData = allToolResults.find(
				(toolResult) =>
					toolResult.toolName === "showPlan" &&
					toolResult.type === "tool-result",
			)?.output as UIPlanType | undefined;

			if (!subtaskPlanResultData) {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const anyResults = allToolResults as any[];
				const errorResults = anyResults.filter(
					(tr) => tr.toolName === "showPlan" && tr.type === "tool-error",
				);
				if (errorResults.length > 0) {
					logger.error("showPlan tool call(s) failed with errors", {
						count: errorResults.length,
						errors: errorResults.map((er) => ({
							error: er.error,
							input: er.input,
						})),
					});
				} else {
					logger.error("No showPlan tool results found at all", {
						allToolResultNames: allToolResults.map(
							(tr) => `${tr.type}:${tr.toolName}`,
						),
					});
				}
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

			// Merge action executor stream and wait for completion
			await mergeStreamAndWait(actionExecutorStream, writer);

			logger.info("Subtask execution completed", {
				subtaskCount: subtaskPlanResultData.todos.length,
			});

			// Check if any subtasks failed
			const hasFailedSubtasks = subtaskPlanResultData.todos.some(
				(t) => t.status === "cancelled",
			);

			if (hasFailedSubtasks) {
				// Check if we've exceeded max retries
				if (attemptCount >= maxRetries) {
					// Max retries exceeded, mark task as failed
					plan.todos[currentTaskIndex].status = "cancelled";
					plan.todos[currentTaskIndex].receipt = {
						outcome: "failed",
						summary: `Task failed after ${maxRetries} retry attempts`,
						at: new Date().toISOString(),
					};

					logger.error("Task failed after max retries", {
						currentTaskIndex,
						attemptCount,
						maxRetries,
					});

					// Generate simulated tool call messages to trigger UI update
					const {
						assistantMessage: failedAssistantMsg,
						toolMessage: failedToolMsg,
					} = await simulateToolCall({
						toolName: "showPlan",
						input: {
							title: plan.title,
							todos: plan.todos,
						},
						output: plan, // The updated plan with cancelled task
					});

					// Inject simulated messages into conversation history
					messages.push(failedAssistantMsg, failedToolMsg);
				} else {
					// Store failure information in current task
					plan.todos[currentTaskIndex].receipt = subtaskPlanResultData.receipt;

					logger.info("Subtasks failed, replanning...", {
						currentTaskIndex,
						attemptCount: attemptCount + 1,
						maxRetries,
					});

					// Recursively call browserUseTaskExecutor to replan
					const replanStream = await browserUseTaskExecutor(
						messages,
						sessionId,
						plan,
						currentTaskIndex,
						maxRetries,
						attemptCount + 1,
					);

					// Merge replan stream and wait for completion
					await mergeStreamAndWait(replanStream, writer);
				}
			} else {
				// All subtasks succeeded, mark task as completed
				plan.todos[currentTaskIndex].status = "completed";

				logger.info("Task completed successfully", {
					currentTaskIndex,
					taskLabel: plan.todos[currentTaskIndex].label,
				});

				// Generate simulated tool call messages to trigger UI update
				const {
					assistantMessage: completedAssistantMsg,
					toolMessage: completedToolMsg,
				} = await simulateToolCall({
					toolName: "showPlan",
					input: {
						title: plan.title,
						todos: plan.todos,
					},
					output: plan, // The updated plan with completed task
				});

				// Inject simulated messages into conversation history
				messages.push(completedAssistantMsg, completedToolMsg);
			}
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
