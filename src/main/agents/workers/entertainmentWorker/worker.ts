import {
  convertToModelMessages,
  type LanguageModel,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import log from "electron-log/main";
import { dehydrateWorker } from "./dehydrate/worker";
import { interactiveWorker } from "./interactive/worker";

const logger = log.scope("EntertainmentWorker");

/**
 * Entertainment router. Mirrors BrowserWorker's convert→route shape, but
 * routes on the entertainment sub-mode instead of browser/search flags.
 *
 *   dehydrate   (网文脱水)   → strip filler from a web novel for cleaner reading
 *   interactive (网文交互)   → turn a novel into HITL-driven interactive fiction
 *
 * Both sub-agents are placeholders for now.
 */
export async function EntertainmentWorker(
  messages: UIMessage[],
  sessionId: string,
  mode: "dehydrate" | "interactive",
  chatLanguageModel: LanguageModel,
  onFinish?: (messages: UIMessage[]) => void,
  signal?: AbortSignal,
): Promise<ReadableStream<UIMessageChunk>> {
  logger.info("request received", {
    messagesCount: messages?.length,
    sessionId,
    mode,
  });

  const modelMessages = await convertToModelMessages(messages);

  if (mode === "interactive") {
    logger.info("routing to interactive (网文交互) placeholder");
    return interactiveWorker(
      modelMessages,
      sessionId,
      messages,
      chatLanguageModel,
      onFinish,
      signal,
    );
  }

  logger.info("routing to dehydrate (网文脱水) placeholder");
  return dehydrateWorker(
    modelMessages,
    sessionId,
    messages,
    chatLanguageModel,
    onFinish,
    signal,
  );
}
