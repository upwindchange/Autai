import {
  convertToModelMessages,
  type LanguageModel,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import type { EntertainmentConfig } from "@shared";
import log from "electron-log/main";
import { interactiveWorker } from "./interactive/worker";

const logger = log.scope("EntertainmentWorker");

/**
 * Entertainment router. Mirrors BrowserWorker's convert→route shape, but
 * routes on the entertainment sub-mode instead of browser/search flags.
 *
 *   dehydrate   (小说重写/润色/脱水) → strip filler from a web novel for cleaner reading
 *   interactive (互动小说)          → turn a novel into HITL-driven interactive fiction
 *
 * Both sub-agents are placeholders for now. The full parsed `config` (mode +
 * novel + options) is forwarded to the chosen sub-agent so its signature is
 * ready when the real logic lands.
 *
 * Routing is an exhaustive `switch` over `config.mode`. Adding a new mode to
 * the `EntertainmentConfig` union without a matching case here is a compile
 * error (the `never` default), keeping this extensible safely.
 */
export async function EntertainmentWorker(
  messages: UIMessage[],
  sessionId: string,
  config: EntertainmentConfig,
  chatLanguageModel: LanguageModel,
  onFinish?: (messages: UIMessage[]) => void,
  signal?: AbortSignal,
): Promise<ReadableStream<UIMessageChunk>> {
  logger.info("request received", {
    messagesCount: messages?.length,
    sessionId,
    mode: config.mode,
  });

  const modelMessages = await convertToModelMessages(messages);

  switch (config.mode) {
    case "dehydrate":
      // Dehydrate no longer routes through this streaming worker — it runs the
      // event-driven `runDehydrate` pipeline from the chapter REST route. The
      // case is kept (as a throw) so the exhaustive `never` guard below still
      // type-checks; the `EntertainmentConfig` union still includes "dehydrate".
      throw new Error(
        "dehydrate does not route through EntertainmentWorker; it is handled by runDehydrate in dehydrate/worker.ts",
      );

    case "interactive":
      logger.info("routing to interactive (网文交互) placeholder");
      return interactiveWorker(
        modelMessages,
        sessionId,
        messages,
        config,
        chatLanguageModel,
        onFinish,
        signal,
      );

    default: {
      // Exhaustiveness guard — TS errors here if a new mode is added to the
      // union without a case above.
      const _exhaustive: never = config;
      void _exhaustive;
      throw new Error(
        `Unhandled entertainment mode: ${JSON.stringify(config)}`,
      );
    }
  }
}
