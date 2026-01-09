import { ChatRequest } from "@shared";
import { toBaseMessages, toUIMessageStream } from "@ai-sdk/langchain";
import log from "electron-log/main";
import { UIMessageChunk } from "ai";
import { browserUseWorkflow } from "./graph";
import { CallbackHandler } from "@langfuse/langchain";

export class BrowserUseWorker {
	private logger = log.scope("BrowserUseWorker");

	constructor() {
		this.logger.info("BrowserUseWorker initialized");
	}

	async handleChat(
		request: ChatRequest,
		useBrowser: boolean,
		webSearch: boolean,
	): Promise<ReadableStream<UIMessageChunk>> {
		const { messages, system, sessionId, tools } = request;

		// Initialize the Langfuse CallbackHandler
		const langfuseHandler = new CallbackHandler({
			sessionId: sessionId,
			tags: ["BrowserUseWorker"],
		});

		this.logger.debug("request received", {
			messagesCount: messages?.length,
			hasSystem: !!system,
			sessionId: sessionId,
			hasTools: !!tools,
			toolCount: tools ? Object.keys(tools).length : 0,
			useBrowser,
			webSearch,
		});

		const langchainMessages = await toBaseMessages(messages);

		const stream = await browserUseWorkflow.stream(
			{
				messages: langchainMessages,
				sessionId,
				useBrowser,
				webSearch,
			},
			{
				callbacks: [langfuseHandler],
			},
		);
		return toUIMessageStream(stream);
	}
}
