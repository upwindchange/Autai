import {
  convertToModelMessages,
  type LanguageModel,
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
  usePlannedBrowser: boolean,
  webSearch: boolean,
  deepResearch: boolean,
  quickSearch: boolean,
  chatLanguageModel: LanguageModel,
  onFinish?: (messages: UIMessage[]) => void,
  signal?: AbortSignal,
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
      chatLanguageModel,
      onFinish,
      signal,
    );
  } else if (useBrowser) {
    logger.info("routing to browser use node", { planned: usePlannedBrowser });
    return browserUseWorker(
      modelMessages,
      sessionId,
      messages,
      chatLanguageModel,
      onFinish,
      { planned: usePlannedBrowser },
      signal,
    );
  } else if (webSearch || quickSearch) {
    logger.info("routing to research node", { quickSearch });
    return browserResearchWorker(
      modelMessages,
      sessionId,
      messages,
      chatLanguageModel,
      onFinish,
      { skipExtraction: quickSearch },
      signal,
    );
  } else {
    throw new Error(
      "Either useBrowser, webSearch, deepResearch, or quickSearch must be true",
    );
  }
}
