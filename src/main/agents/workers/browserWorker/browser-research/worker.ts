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

const systemPrompt = `placeholder`;

const logger = log.scope("Research Worker");

export async function browserResearchWorker(
	messages: ModelMessage[],
	sessionId: string,
): Promise<GenerateTextResult<any, any>> {
	try {
		logger.debug("creating stream with chat model");

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
				functionId: "research-worker",
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
