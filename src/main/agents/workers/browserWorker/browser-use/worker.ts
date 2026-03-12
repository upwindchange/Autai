import {
	stepCountIs,
	GenerateTextResult,
	generateText,
	ModelMessage,
} from "ai";
import { chatModel } from "@agents/providers";
import { repairToolCall, simulateToolCall } from "@agents/utils";
import { settingsService } from "@/services";
import log from "electron-log/main";
import { browserUsePlanner, type UIPlanType } from "./planner";
import { browserUseTaskExecutor } from "./task-executor";

const systemPrompt = `placeholder`;

const logger = log.scope("Browser Use Worker");

export async function browserUseWorker(
	messages: ModelMessage[],
	sessionId: string,
): Promise<GenerateTextResult<any, any>> {
	try {
		logger.info("Entering Browser Use worker");

		const plan = await browserUsePlanner(messages, sessionId);

		// Initialize task execution loop
		let currentTaskIndex = 0;
		let previousSubtaskPlan: UIPlanType | undefined;

		// Loop through tasks sequentially
		while (currentTaskIndex < plan.todos.length) {
			logger.debug("Processing task", {
				currentTaskIndex,
				totalTasks: plan.todos.length,
			});

			const subtaskPlan = await browserUseTaskExecutor(
				messages,
				sessionId,
				plan,
				currentTaskIndex,
				previousSubtaskPlan,
			);

			// Check if task completed successfully (all subtasks done)
			if (subtaskPlan.todos.every((t) => t.status === "completed")) {
				// Mark current task as completed
				plan.todos[currentTaskIndex].status = "completed";

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

				messages.push(completedAssistantMsg, completedToolMsg);

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
					failedSubtaskCount: subtaskPlan.todos.filter(
						(t) => t.status === "cancelled",
					).length,
				});
				// Keep subtask plan for failure context in next attempt
				previousSubtaskPlan = subtaskPlan;
			}
		}

		// Configure stop conditions based on available tools
		const stopConditions = [
			// Safety limit to prevent infinite loops
			stepCountIs(20),
		];

		const result = generateText({
			model: chatModel(),
			messages,
			system: systemPrompt,
			stopWhen: stopConditions,
			experimental_repairToolCall: repairToolCall,
			experimental_telemetry: {
				isEnabled: settingsService.settings.langfuse.enabled,
				functionId: "browser-use-worker",
				metadata: {
					langfuseTraceId: sessionId,
				},
			},
		});

		logger.debug("returning stream text result");
		// Convert StreamTextResult to ReadableStream for consistency
		return result;
	} catch (error) {
		logger.error("failed to create stream", {
			error,
			stack: error instanceof Error ? error.stack : undefined,
		});
		throw error;
	}
}
