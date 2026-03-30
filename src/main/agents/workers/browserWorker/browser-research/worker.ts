import {
  stepCountIs,
  streamText,
  createUIMessageStream,
  UIMessageChunk,
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
): Promise<ReadableStream<UIMessageChunk>> {
  try {
    logger.debug("creating stream with chat model");

    return createUIMessageStream({
      execute: async ({ writer }) => {
        // Configure stop conditions based on available tools
        const stopConditions = [
          // Safety limit to prevent infinite loops
          stepCountIs(20),
        ];

        const result = streamText({
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
        // Merge the streamText result into the UI message stream
        writer.merge(result.toUIMessageStream());
      },
    });
  } catch (error) {
    logger.error("failed to create stream", {
      error,
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}
