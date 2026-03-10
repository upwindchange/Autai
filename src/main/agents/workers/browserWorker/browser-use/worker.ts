import {
	stepCountIs,
	GenerateTextResult,
	generateText,
	ModelMessage,
} from "ai";
import { chatModel } from "@agents/providers";
import { repairToolCall } from "@agents/utils";
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

		// Loop through tasks until completion
		while (currentTaskIndex !== -1 && currentTaskIndex < plan.todos.length) {
			logger.debug("Processing task", {
				currentTaskIndex,
				totalTasks: plan.todos.length,
			});

			const result = await browserUseTaskExecutor(
				messages,
				sessionId,
				plan,
				currentTaskIndex,
				previousSubtaskPlan,
			);

			if (result.nextAction === "complete") {
				logger.info("Task execution completed successfully");
				break;
			}

			// Store the subtask plan for the next iteration
			previousSubtaskPlan = result.subtaskPlan;

			// Find the next pending task to process
			currentTaskIndex = plan.todos.findIndex(
				(todo) => todo.status === "pending" || todo.status === "in_progress",
			);

			// If no more pending tasks, we're done
			if (currentTaskIndex === -1) {
				logger.info("All tasks completed");
				break;
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
