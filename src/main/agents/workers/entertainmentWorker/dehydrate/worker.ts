import {
  createUIMessageStream,
  type LanguageModel,
  type ModelMessage,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import type { DehydrateConfig } from "@shared";
import log from "electron-log/main";
import { SAMPLE_NOVEL_PARAGRAPHS } from "../sample-novel";

const logger = log.scope("EntertainmentWorker:Dehydrate");

/**
 * 网文脱水 (web-novel dehydrate) — placeholder.
 *
 * eventual behaviour: read a web novel, strip the filler ("水分") so it reads
 * cleaner. the real implementation will mirror browser-research (fetch →
 * extract → dehydrate/summarize). for now it streams a long, structured CJK
 * sample so the entertainment-mode reading UI is end-to-end testable.
 *
 * the full param list is kept (and intentionally unused for now) so the
 * signature is ready when the real dehydrate logic lands.
 */
export async function dehydrateWorker(
  _messages: ModelMessage[],
  sessionId: string,
  originalMessages: UIMessage[],
  config: DehydrateConfig,
  _chatLanguageModel: LanguageModel,
  onFinish?: (messages: UIMessage[]) => void,
  signal?: AbortSignal,
): Promise<ReadableStream<UIMessageChunk>> {
  const userInputPreview = originalMessages
    .filter((m) => m.role === "user")
    .flatMap((m) => m.parts)
    .map((p) => (p.type === "text" ? p.text : ""))
    .join(" ")
    .slice(0, 160);

  // config is logged (not yet acted on) so the wizard → route → worker path is
  // verifiable from the main-process logs. Real dehydrate logic lands later.
  logger.info("dehydrate placeholder invoked", {
    sessionId,
    userInputPreview,
    config,
  });

  return createUIMessageStream({
    // originalMessages + onFinish mirror the browserWorker pattern so the
    // streamed turn (and the user's start-form input) persist to the DB and
    // survive a reload — without this, createUIMessageStream has no way to
    // reconstruct the final message list to hand to onFinish.
    originalMessages,
    onFinish:
      onFinish ?
        ({ messages: finalMessages }) => onFinish(finalMessages)
      : undefined,
    execute: async ({ writer }) => {
      const textId = "dehydrate-stub";
      writer.write({ type: "text-start", id: textId });

      // One text-delta per paragraph (each followed by "\n\n" so streamdown
      // splits headings/paragraphs into <h1>/<p>). A small delay between
      // chunks makes the streaming cursor visible without dragging out a long
      // sample.
      for (const paragraph of SAMPLE_NOVEL_PARAGRAPHS) {
        if (signal?.aborted) break;
        writer.write({
          type: "text-delta",
          id: textId,
          delta: `${paragraph}\n\n`,
        });
        await new Promise((resolve) => setTimeout(resolve, 250));
      }

      writer.write({ type: "text-end", id: textId });
    },
  });
}
