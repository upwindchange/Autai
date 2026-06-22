import {
  createUIMessageStream,
  type LanguageModel,
  type ModelMessage,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import log from "electron-log/main";

const logger = log.scope("EntertainmentWorker:Dehydrate");

/**
 * 网文脱水 (web-novel dehydrate) — placeholder.
 *
 * eventual behaviour: read a web novel, strip the filler ("水分") so it reads
 * cleaner. the real implementation will mirror browser-research (fetch →
 * extract → dehydrate/summarize). for now it returns a single stub text turn so
 * the /entertainment endpoint is end-to-end testable.
 *
 * the full param list is kept (and intentionally unused for now) so the
 * signature is ready when the real dehydrate logic lands.
 */
export async function dehydrateWorker(
  messages: ModelMessage[],
  sessionId: string,
  originalMessages: UIMessage[],
  chatLanguageModel: LanguageModel,
  onFinish?: (messages: UIMessage[]) => void,
  signal?: AbortSignal,
): Promise<ReadableStream<UIMessageChunk>> {
  logger.info("dehydrate placeholder invoked", { sessionId });

  return createUIMessageStream({
    execute: async ({ writer }) => {
      const textId = "dehydrate-placeholder";
      writer.write({ type: "text-start", id: textId });
      writer.write({
        type: "text-delta",
        id: textId,
        delta: "[网文脱水 placeholder — not implemented yet.]",
      });
      writer.write({ type: "text-end", id: textId });
    },
  });
}
