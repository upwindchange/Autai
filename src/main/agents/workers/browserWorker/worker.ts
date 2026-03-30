import {
  convertToModelMessages,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import log from "electron-log/main";
import { browserResearchWorker } from "@agents/workers/browserWorker/browser-research/worker";
import { browserUseWorker } from "@agents/workers/browserWorker/browser-use/worker";

const logger = log.scope("BrowserUseWorker");
export async function BrowserWorker(
  messages: UIMessage[],
  sessionId: string,
  useBrowser: boolean,
  webSearch: boolean,
): Promise<ReadableStream<UIMessageChunk>> {
  logger.info("request received", {
    messagesCount: messages?.length,
    sessionId: sessionId,
  });
  const modelMessages = await convertToModelMessages(messages);
  if (useBrowser) {
    logger.info("routing to browser use node");
    return browserUseWorker(modelMessages, sessionId);
  } else if (webSearch) {
    logger.info("routing to reseach node");
    return browserResearchWorker(modelMessages, sessionId);
  } else {
    throw new Error("Either useBrowser or webSearch must be true");
  }
}
