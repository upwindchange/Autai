import {
  createUIMessageStream,
  type LanguageModel,
  type ModelMessage,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import log from "electron-log/main";

const logger = log.scope("EntertainmentWorker:Interactive");

/**
 * 网文交互 (web-novel interactive) — placeholder.
 *
 * eventual behaviour: turn a novel into interactive fiction driven by HITL
 * tools so the user can steer the story. the real implementation will mirror
 * browser-use (planner → action/step executor with human-in-the-loop pauses).
 * for now it returns a single stub text turn so the /entertainment endpoint is
 * end-to-end testable.
 *
 * the full param list is kept (and intentionally unused for now) so the
 * signature is ready when the real interactive logic lands.
 */
export async function interactiveWorker(
  messages: ModelMessage[],
  sessionId: string,
  originalMessages: UIMessage[],
  chatLanguageModel: LanguageModel,
  onFinish?: (messages: UIMessage[]) => void,
  signal?: AbortSignal,
): Promise<ReadableStream<UIMessageChunk>> {
  logger.info("interactive placeholder invoked", { sessionId });

  return createUIMessageStream({
    execute: async ({ writer }) => {
      const textId = "interactive-placeholder";
      writer.write({ type: "text-start", id: textId });
      writer.write({
        type: "text-delta",
        id: textId,
        delta: "[网文交互 placeholder — not implemented yet.]",
      });
      writer.write({ type: "text-end", id: textId });
    },
  });
}
