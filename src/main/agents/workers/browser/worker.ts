import { ChatRequest } from "@shared";
import { toBaseMessages, toUIMessageStream } from "@ai-sdk/langchain";
import log from "electron-log/main";
import { complexLangchainModel } from "@/agents/providers";
import { UIMessageChunk } from "ai";

export class BrowserUseWorker {
	private logger = log.scope("BrowserUseWorker");

	constructor() {
		this.logger.info("BrowserUseWorker initialized");
	}

	async handleChat(
		request: ChatRequest,
	): Promise<ReadableStream<UIMessageChunk>> {
		const { messages, system, sessionId, tools } = request;
		this.logger.debug("request received", {
			messagesCount: messages?.length,
			hasSystem: !!system,
			sessionId: sessionId,
			hasTools: !!tools,
			toolCount: tools ? Object.keys(tools).length : 0,
		});

		const model = complexLangchainModel;

		const langchainMessages = await toBaseMessages(messages);

		const stream = await model.stream(langchainMessages);
		return toUIMessageStream(stream);
	}
}
