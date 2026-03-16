import {
	streamText,
	tool,
	createUIMessageStream,
	type ModelMessage,
} from "ai";
import { z } from "zod";
import { complexModel } from "@agents/providers";
import { settingsService } from "@/services";
import { SessionTabService } from "@/services";
import { simulateToolCall } from "@agents/utils";
import log from "electron-log/main";
import { interactiveTools } from "@/agents/ai-tools/InteractiveTools";
import { navigationTools } from "@/agents/ai-tools/TabControlTools";
import { getFlattenDOMTool } from "@/agents/ai-tools/DOMTools";
import type { UIPlanType, UIPlanTodo } from "./planner";

const logger = log.scope("browser-use-action-executor");

// ============================================================================
// Types
// ============================================================================

interface SubtaskEvaluation {
	is_task_successful: boolean;
	result_explanation: string;
}

// ============================================================================
// System Prompts
// ============================================================================

const ACTION_EXECUTOR_PROMPT = `# Role
Browser automation action executor. Execute subtasks sequentially using browser tools.

# Available Tools
Interactive elements: click, fill, select, hover, drag
Page navigation: navigate, refresh, go back, go forward
Page scrolling: scroll by pages or at coordinates
DOM analysis: getFlattenDOMTool (flattened DOM representation)
Element inspection: get attributes, evaluate JavaScript, get basic info

# Tab Context
Active tab is pre-selected. All interactive tools use this tab automatically. Do NOT specify tabId.
Note: If you see "No DOM tree available", it means no page is loaded yet. Browser and tab are still available - proceed with actions like navigate.

# DOM State Management Rules

## Call getFlattenDOMTool:
1. First action of each subtask
2. After state-changing actions: clickElementTool, navigateTool, refreshTool, fillElementTool with submit=true
3. After 3+ actions without checking DOM
4. When uncertain about page state

## Skip getFlattenDOMTool:
1. After read-only actions: getElementAttributeTool, evaluateJavaScriptTool (reading), scrollPagesTool
2. If called within last 2 actions and page unchanged
3. If you already have the element's backendNodeId from previous action

## BackendNodeId Persistence
backendNodeId values persist across subtasks. If you found backendNodeId=123 in subtask 1, it remains valid in subtask 2. Use this knowledge to skip unnecessary DOM checks.

# DOM Format Reference

## Element Markers
[N]<tag> - Interactive element with backendNodeId N
*[N]<tag> - NEW element (first observation since last check)
|SCROLL[N]<tag> - Scrollable AND interactive
|SCROLL|<tag> - Scrollable but NOT interactive
|IFRAME|<iframe> / |FRAME|<frame> - Embedded frame
|SHADOW(open)| / |SHADOW(closed)| - Shadow DOM boundary

## Structure
Tab indentation = nesting level
Text content = separate lines without brackets
Attributes included: role, aria-label, placeholder, value, type, etc.
Scroll position: scroll: horizontal: X%, vertical: Y%

## Example
[49]<div role=navigation />
	[52]<a>About</a>
	[64]<a aria-label=Search for Images>Images</a>
	*[68]<button expanded=false>Menu</button>

To click "Menu": clickElementTool with backendNodeId=68

# Execution Flow

For each subtask:
1. Call getFlattenDOMTool to understand initial state
2. Note: "No DOM tree available" means no page loaded. Browser and tab are always available. Proceed normally.
3. Use backendNodeId from previous results when available
4. Execute actions sequentially
5. After each action: judge if it changed page state
   - Changed: Call getFlattenDOMTool
   - Unchanged: Skip getFlattenDOMTool
6. Continue until subtask complete or determined to fail

# Output Format
After completing a subtask, provide a text summary that includes:
- What actions were taken
- What the final DOM state shows
- Any errors or unexpected behavior
- Your assessment of whether the subtask goal was achieved

This summary will be reviewed by an evaluator agent to make the final success/failure determination.`;

const EVALUATOR_PROMPT = `# Role
Subtask evaluation agent. Judge if a subtask was successfully completed.

# Your Task
Evaluate whether the current subtask was accomplished based on:
1. The subtask's description and goal
2. The action-executor's execution summary
3. The current DOM state

# Evaluation Criteria
- Success: The subtask's goal is achieved based on execution summary and DOM state
- Failure: The goal was not achieved, or the action-executor encountered errors

# Required Action
You MUST call the evaluateSubtaskTool with your evaluation:
- is_task_successful: boolean (true if goal achieved, false otherwise)
- result_explanation: string (clear explanation of why it succeeded or failed)

# Important Context
- DOM state may show "No DOM tree available" if no page is loaded
- The action-executor's summary describes what actions were taken
- Compare the expected outcome (subtask description) with actual DOM state`;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Build context for action executor
 */
function buildSubtaskContext(
	subtask: UIPlanTodo,
	previousSubtasks: UIPlanTodo[],
): string {
	let context = "";

	// Add previously completed subtasks
	if (previousSubtasks.length > 0) {
		const completedSubtasks = previousSubtasks.filter(
			(s) => s.status === "completed",
		);
		if (completedSubtasks.length > 0) {
			context += `## Previously Completed Subtasks:\n${JSON.stringify(completedSubtasks, null, 2)}\n\n`;
		}
	}

	// Add current subtask
	context += `## Current Subtask to Execute:\n${JSON.stringify(subtask, null, 2)}`;

	return context;
}

/**
 * Build evaluation context
 */
function buildEvaluationContext(
	subtask: UIPlanTodo,
	executionSummary: string,
	domState: string,
	previousSubtasks: UIPlanTodo[],
): string {
	let context = "";

	// Add current subtask
	context += `## Current Subtask to Evaluate:\n${JSON.stringify(subtask, null, 2)}\n\n`;

	// Add action-executor's execution summary
	context += `## Action Executor Summary:\n${executionSummary}\n\n`;

	// Add current DOM state
	context += `## Current DOM State:\n${domState}\n\n`;

	// Add context about previous subtasks (if any)
	if (previousSubtasks.length > 0) {
		const completedSubtasks = previousSubtasks.filter(
			(s) => s.status === "completed",
		);
		if (completedSubtasks.length > 0) {
			context += `## Previously Completed Subtasks:\n${JSON.stringify(completedSubtasks, null, 2)}\n\n`;
		}
	}

	return context;
}

/**
 * Get current DOM state
 */
function getDomState(activeTabId?: string): string {
	if (!activeTabId) {
		return "No DOM tree available";
	}

	const sessionTabService = SessionTabService.getInstance();
	const domService = sessionTabService.getDomService(activeTabId);
	return (
		domService?.simplifiedDOMState?.flattenedDOM ?? "No DOM tree available"
	);
}

// ============================================================================
// Tools
// ============================================================================

/**
 * Evaluation tool for subtask assessment
 * Returns structured evaluation result that can be extracted directly
 */
const evaluateSubtaskTool = tool({
	description: "Evaluate whether a subtask was successfully completed",
	inputSchema: z.object({
		is_task_successful: z
			.boolean()
			.describe("true if task is successful, false if task failed"),
		result_explanation: z
			.string()
			.describe("clear explanation of why it succeeded or failed"),
	}),
	execute: async ({ is_task_successful, result_explanation }) => {
		// Return structured data directly to code scope
		return {
			is_task_successful,
			result_explanation,
		};
	},
});

// ============================================================================
// Evaluation Function
// ============================================================================

/**
 * Evaluate if a subtask was successfully completed
 *
 * @param subtask - The subtask to evaluate
 * @param executionSummary - Summary from action executor
 * @param domState - Current DOM state
 * @param previousSubtasks - Previously completed subtasks
 * @returns StreamTextResult that streams the evaluation
 */
export async function evaluateSubtask(
	subtask: UIPlanTodo,
	executionSummary: string,
	domState: string,
	previousSubtasks: UIPlanTodo[],
) {
	const evaluationContext = buildEvaluationContext(
		subtask,
		executionSummary,
		domState,
		previousSubtasks,
	);

	const result = streamText({
		model: complexModel(),
		system: EVALUATOR_PROMPT,
		messages: [{ role: "user", content: evaluationContext }],
		tools: {
			evaluateSubtaskTool,
		},
		experimental_telemetry: {
			isEnabled: settingsService.settings.langfuse.enabled,
			functionId: "browser-use-evaluator",
			metadata: {
				subtaskId: subtask.id,
				subtaskLabel: subtask.label,
			},
		},
	});

	return result;
}

// ============================================================================
// Main Execution Function
// ============================================================================

/**
 * Execute subtasks sequentially using AI SDK streaming patterns
 *
 * Modifies subtaskPlan in-place - no need to return it.
 * Returns a StreamTextResult that streams all subtask executions.
 *
 * @param subtaskPlan - The subtask plan to execute (modified in-place)
 * @param sessionId - The current session ID
 * @param messages - The conversation messages
 * @returns StreamTextResult that streams all subtask executions
 */
export async function executeSubtasks(
	subtaskPlan: UIPlanType,
	sessionId: string,
	messages: ModelMessage[],
): Promise<ReturnType<typeof createUIMessageStream>> {
	logger.debug("Starting subtask execution stream", {
		sessionId,
		subtaskCount: subtaskPlan.todos.length,
	});

	// ============================================================
	// SETUP CONTEXT (zero-token passing)
	// ============================================================
	const sessionTabService = SessionTabService.getInstance();
	const activeTabId = sessionTabService.getActiveTabForSession(sessionId);

	// Assert that an active tab exists
	if (!activeTabId) {
		logger.error("No active tab found for session", {
			sessionId,
		});
		throw new Error(
			"Cannot execute subtasks: No active tab found for this session",
		);
	}

	// Create context for tools (only sessionId and activeTabId are needed)
	const context = {
		sessionId,
		activeTabId,
	};

	// ============================================================
	// PREPARE TOOLS
	// ============================================================
	const allTools = {
		getFlattenDOMTool,
		...interactiveTools,
		...navigationTools,
	};

	// ============================================================
	// CREATE STREAM THAT EXECUTES SUBTASKS SEQUENTIALLY
	// ============================================================
	return createUIMessageStream({
		execute: async ({ writer }) => {
			let allSuccessful = true;

			// ============================================================
			// EXECUTE SUBTASKS SEQUENTIALLY
			// ============================================================
			for (let i = 0; i < subtaskPlan.todos.length; i++) {
				const subtask = subtaskPlan.todos[i];
				const completedSubtasks = subtaskPlan.todos.slice(0, i);

				logger.debug("Executing subtask", {
					subtaskId: subtask.id,
					subtaskLabel: subtask.label,
					index: i,
				});

				try {
					// ============================================================
					// BUILD CONTEXT FOR THIS SUBTASK
					// ============================================================
					const subtaskContext = buildSubtaskContext(subtask, completedSubtasks);

					// ============================================================
					// EXECUTE ACTIONS FOR THIS SUBTASK (streaming)
					// ============================================================
					const actionResult = streamText({
						model: complexModel(),
						system: ACTION_EXECUTOR_PROMPT,
						messages: [{ role: "user", content: subtaskContext }],
						tools: allTools,
						experimental_context: context,
						experimental_telemetry: {
							isEnabled: settingsService.settings.langfuse.enabled,
							functionId: "browser-use-action-executor",
							metadata: {
								sessionId,
								subtaskId: subtask.id,
								subtaskLabel: subtask.label,
								subtaskIndex: i,
							},
						},
					});

					// Merge action execution stream
					writer.merge(
						actionResult.toUIMessageStream({ sendStart: false }),
					);

					// Wait for action execution to complete
					await actionResult.finishReason;

					// ============================================================
					// EXTRACT EXECUTION SUMMARY
					// ============================================================
					const response = await actionResult.response;
					const lastMessage =
						response.messages[response.messages.length - 1];
					const executionSummary =
						typeof lastMessage.content === "string" ?
							lastMessage.content
						:	JSON.stringify(lastMessage.content);

					logger.debug("Subtask execution completed", {
						subtaskId: subtask.id,
						hasToolResults: (await actionResult.toolResults).length > 0,
						executionSummary: executionSummary,
					});

					// ============================================================
					// GET CURRENT DOM STATE
					// ============================================================
					const domState = getDomState(activeTabId);

					// ============================================================
					// EVALUATE SUBTASK SUCCESS (streaming)
					// ============================================================
					const evaluationResult = await evaluateSubtask(
						subtask,
						executionSummary,
						domState,
						completedSubtasks,
					);

					// Merge evaluation stream
					writer.merge(
						evaluationResult.toUIMessageStream({ sendStart: false }),
					);

					// Wait for evaluation to complete
					await evaluationResult.finishReason;

					// Extract evaluation result
					const steps = await evaluationResult.steps;
					const allToolResults = steps.flatMap(
						(step) => step.toolResults ?? [],
					);
					const evaluation = allToolResults.find(
						(toolResult) => toolResult.toolName === "evaluateSubtaskTool",
					)?.output as SubtaskEvaluation | undefined;

					if (!evaluation) {
						logger.error("Evaluation tool did not return a result", {
							subtaskId: subtask.id,
							toolResults: allToolResults,
						});
						throw new Error("Evaluation failed: no tool result returned");
					}

					logger.debug("Subtask evaluation completed", {
						subtaskId: subtask.id,
						isSuccessful: evaluation.is_task_successful,
						result_explanation: evaluation.result_explanation,
					});

					// ============================================================
					// UPDATE SUBTASK STATUS IN-PLACE
					// ============================================================
					subtask.status =
						evaluation.is_task_successful ? "completed" : "cancelled";

					// Populate receipt with evaluation result for task executor
					subtaskPlan.receipt = {
						outcome: evaluation.is_task_successful ? "success" : "cancelled",
						summary: evaluation.result_explanation,
						at: new Date().toISOString(),
					};

					// Generate simulated tool call messages to trigger UI update
					const {
						assistantMessage: subtaskAssistantMsg,
						toolMessage: subtaskToolMsg,
					} = await simulateToolCall({
						toolName: "showPlan",
						input: {
							title: subtaskPlan.title,
							todos: subtaskPlan.todos,
						},
						output: subtaskPlan, // The updated subtask plan with new status
					});

					// Inject simulated messages into conversation history
					messages.push(subtaskAssistantMsg, subtaskToolMsg);

					logger.debug("Simulated showPlan tool call for subtask status", {
						subtaskId: subtask.id,
						status: subtask.status,
					});

					// ============================================================
					// STOP IF SUBTASK FAILED
					// ============================================================
					if (!evaluation.is_task_successful) {
						// Enrich execution summary with failure explanation for task executor
						const enrichedSummary = `${executionSummary}\n\nSubtask Evaluation: ${evaluation.result_explanation}`;

						logger.info("Subtask failed, stopping execution", {
							subtaskId: subtask.id,
							subtaskLabel: subtask.label,
							enrichedSummary,
						});
						allSuccessful = false;
						break; // Stop processing more subtasks
					}
				} catch (error) {
					// ============================================================
					// ERROR HANDLING
					// ============================================================
					logger.error("Subtask execution error", {
						subtaskId: subtask.id,
						subtaskLabel: subtask.label,
						error,
					});

					// Mark subtask as cancelled
					subtask.status = "cancelled";

					allSuccessful = false;
					break; // Stop processing more subtasks
				}
			}

			// ============================================================
			// ALL SUBTASKS COMPLETED (OR FAILED)
			// ============================================================
			if (allSuccessful) {
				logger.info("All subtasks completed successfully", {
					totalSubtasks: subtaskPlan.todos.length,
				});
			} else {
				logger.info("Some subtasks failed", {
					totalSubtasks: subtaskPlan.todos.length,
					failedCount: subtaskPlan.todos.filter(
						(t) => t.status === "cancelled",
					).length,
				});
			}
		},
		onError: (error) => {
			logger.error("Error in action executor stream", {
				error,
				stack: error instanceof Error ? error.stack : undefined,
			});
			return error instanceof Error ? error.message : String(error);
		},
	});
}
