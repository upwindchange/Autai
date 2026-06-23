import {
  createUIMessageStream,
  type LanguageModel,
  type ModelMessage,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import type { InteractiveConfig } from "@shared";
import log from "electron-log/main";
import { SAMPLE_NOVEL_PARAGRAPHS } from "../sample-novel";

const logger = log.scope("EntertainmentWorker:Interactive");

/**
 * 网文交互 (web-novel interactive) — placeholder.
 *
 * eventual behaviour: turn a novel into interactive fiction driven by HITL
 * tools so the user can steer the story. the real implementation will mirror
 * browser-use (planner → action/step executor with human-in-the-loop pauses).
 * for now it streams a long, structured CJK sample so the entertainment-mode
 * reading UI is end-to-end testable.
 *
 * the full param list is kept (and intentionally unused for now) so the
 * signature is ready when the real interactive logic lands.
 */
export async function interactiveWorker(
  messages: ModelMessage[],
  sessionId: string,
  originalMessages: UIMessage[],
  config: InteractiveConfig,
  chatLanguageModel: LanguageModel,
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
  // verifiable from the main-process logs. Real interactive logic lands later.
  logger.info("interactive placeholder invoked", {
    sessionId,
    userInputPreview,
    config,
  });

  return createUIMessageStream({
    // originalMessages + onFinish mirror the browserWorker pattern so the
    // streamed turn (and the user's start-form input) persist to the DB and
    // survive a reload.
    originalMessages,
    onFinish:
      onFinish ?
        ({ messages: finalMessages }) => onFinish(finalMessages)
      : undefined,
    execute: async ({ writer }) => {
      const textId = "interactive-stub";
      writer.write({ type: "text-start", id: textId });

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
