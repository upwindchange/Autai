import {
  convertToModelMessages,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import log from "electron-log/main";
import { browserResearchWorker } from "@agents/workers/browserWorker/browser-research/worker";
import { browserUseWorker } from "@agents/workers/browserWorker/browser-use/worker";
import { browserDeepResearchWorker } from "@agents/workers/browserWorker/deep-research/worker";

const logger = log.scope("BrowserUseWorker");
export async function BrowserWorker(
  messages: UIMessage[],
  sessionId: string,
  useBrowser: boolean,
  webSearch: boolean,
  deepResearch: boolean,
  onFinish?: (messages: UIMessage[]) => void,
): Promise<ReadableStream<UIMessageChunk>> {
  logger.info("request received", {
    messagesCount: messages?.length,
    sessionId: sessionId,
  });
  const modelMessages = await convertToModelMessages(messages);
  if (deepResearch) {
    logger.info("routing to deep research node");
    return browserDeepResearchWorker(
      modelMessages,
      sessionId,
      messages,
      onFinish,
    );
  } else if (useBrowser) {
    logger.info("routing to browser use node");
    return browserUseWorker(modelMessages, sessionId, messages, onFinish);
  } else if (webSearch) {
    logger.info("routing to research node");
    return browserResearchWorker(modelMessages, sessionId, messages, onFinish);
  } else {
    throw new Error("Either useBrowser, webSearch, or deepResearch must be true");
  }
}
