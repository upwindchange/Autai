import {
	streamText,
	createUIMessageStream,
	UIMessageChunk,
	ModelMessage,
} from "ai";
import { chatModel } from "@agents/providers";
import { settingsService } from "@/services";
import log from "electron-log/main";
import { browserUsePlanner, type UIPlanType } from "./planner";
import { browserUseTaskExecutor } from "./task-executor";

const logger = log.scope("Browser Use Worker");

const systemPrompt = `You are a browser automation assistant. Summarize what was accomplished and provide any relevant next steps or recommendations.`;

export async function browserUseWorker(
	messages: ModelMessage[],
	sessionId: string,
): Promise<ReadableStream<UIMessageChunk>> {
	try {
		logger.info("Entering Browser Use worker");

		return createUIMessageStream({
			execute: async ({ writer }) => {
				// ============================================================
				// Stage 1: Planning
				// ============================================================
				logger.debug("Stage 1: Generating high-level plan");
				const planResult = await browserUsePlanner(messages, sessionId);

				// Merge planning stream
				writer.merge(
					planResult.toUIMessageStream({ sendStart: false }),
				);

				// Wait for planning to complete
				await planResult.finishReason;

				// Extract plan from tool result
				const steps = await planResult.steps;
				const planToolResult = steps
					.flatMap((s) => s.toolResults ?? [])
					.find((tr) => tr.toolName === "generatePlan");
				const plan = planToolResult?.output as UIPlanType;

				if (!plan) {
					logger.error("Failed to generate plan: tool not called");
					throw new Error(
						"Failed to generate plan: generatePlan tool not called",
					);
				}

				logger.info("Plan generated successfully", {
					taskCount: plan.todos.length,
				});

				// ============================================================
				// Stage 2-3: Task execution loop
				// ============================================================
				let currentTaskIndex = 0;
				let previousSubtaskPlan: UIPlanType | undefined;

				while (currentTaskIndex < plan.todos.length) {
					logger.debug("Processing task", {
						currentTaskIndex,
						totalTasks: plan.todos.length,
					});

					// Execute task (including subtask planning and execution)
					const taskExecutorStream = await browserUseTaskExecutor(
						messages,
						sessionId,
						plan,
						currentTaskIndex,
						previousSubtaskPlan,
					);

					// Merge task execution stream
					writer.merge(taskExecutorStream);

					// Wait for stream to complete
					const reader = taskExecutorStream.getReader();
					while (true) {
						const { done } = await reader.read();
						if (done) break;
					}
					reader.releaseLock();

					// Check if task completed successfully (all subtasks done)
					if (plan.todos[currentTaskIndex].status === "completed") {
						logger.info("Task completed, moving to next", {
							completedIndex: currentTaskIndex,
						});

						// Move to next task
						currentTaskIndex += 1;
						// Clear previous subtask plan for fresh task
						previousSubtaskPlan = undefined;
					} else {
						// Task failed, keep same index for retry
						logger.info("Task failed, will retry", {
							currentTaskIndex,
							failedSubtaskCount: plan.todos.filter(
								(t) => t.status === "cancelled",
							).length,
						});
						// Keep subtask plan for failure context in next attempt
						previousSubtaskPlan = plan;
					}
				}

				// ============================================================
				// Stage 4: Final summary
				// ============================================================
				logger.debug("Stage 4: Generating final summary");
				const summaryResult = streamText({
					model: chatModel(),
					messages,
					system: systemPrompt,
					experimental_telemetry: {
						isEnabled: settingsService.settings.langfuse.enabled,
						functionId: "browser-use-summary",
						metadata: {
							langfuseTraceId: sessionId,
						},
					},
				});

				// Merge summary stream
				writer.merge(
					summaryResult.toUIMessageStream({ sendStart: false }),
				);

				// Wait for summary to complete
				await summaryResult.finishReason;

				logger.info("Browser use workflow completed successfully");
			},
			onError: (error) => {
				logger.error("Error in browser use worker", {
					error,
					stack: error instanceof Error ? error.stack : undefined,
				});
				return error instanceof Error ? error.message : String(error);
			},
		});
	} catch (error) {
		logger.error("Failed to create browser use worker stream", {
			error,
			stack: error instanceof Error ? error.stack : undefined,
		});
		throw error;
	}
}
