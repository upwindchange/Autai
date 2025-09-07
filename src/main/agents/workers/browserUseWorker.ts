import { streamText, convertToModelMessages, type UIMessage } from "ai";
import { complexModel } from "@agents/providers";
import { isDevMode, repairToolCall } from "@agents/utils";
import log from "electron-log/main";

export interface ChatRequest {
  messages: UIMessage[];
  system?: string;
  tools?: unknown;
}

const systemPrompt = `You are a helpful AI assistant integrated into a web browser automation tool. 
                         You can help users navigate web pages, answer questions about the current page content, 
                         and provide assistance with browser automation tasks.
                         You have access to browser automation tools that can interact with web pages.
                         When helping users with browser tasks, be clear and precise in your instructions.`;

export class BrowserUseWorker {
  private logger = log.scope('BrowserUseWorker');
  async handleChat(request: ChatRequest): Promise<ReadableStream> {
    const { messages, system } = request;
    this.logger.debug("request received", {
      messagesCount: messages?.length,
      hasSystem: !!system
    });

    try {
      this.logger.debug("creating stream with complex model");

      // Simple chat implementation without tools for now
      const result = streamText({
        model: await complexModel(),
        messages: convertToModelMessages(messages),
        system: `${systemPrompt} ${system || ""}`,
        experimental_repairToolCall: repairToolCall,
        experimental_telemetry: { isEnabled: isDevMode() },
      });

      this.logger.debug("converting to ui message stream");
      return result.toUIMessageStream();
    } catch (error) {
      this.logger.error("failed to create stream", {
        error,
        stack: error instanceof Error ? error.stack : undefined
      });
      throw error;
    }
  }
}
