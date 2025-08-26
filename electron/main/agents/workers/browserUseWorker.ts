import { streamText, convertToModelMessages, type UIMessage } from "ai";
import { complexModel } from "@backend/agents/providers";
import { repairToolCall } from "@agents/utils";

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
  async handleChat(request: ChatRequest): Promise<ReadableStream> {
    const { messages, system } = request;
    console.log("[BROWSER USE WORKER] Request received:", {
      messagesCount: messages?.length,
      system,
      messages: JSON.stringify(messages, null, 2),
    });

    try {
      console.log("[BROWSER USE WORKER] Creating streamText with simple model");

      // Simple chat implementation without tools for now
      const result = streamText({
        model: await complexModel,
        messages: convertToModelMessages(messages),
        system: `${systemPrompt} ${system || ""}`,
        experimental_repairToolCall: repairToolCall,
      });

      console.log("[BROWSER USE WORKER] Converting to UI message stream...");
      return result.toUIMessageStream();
    } catch (error) {
      console.error("[BROWSER USE WORKER:ERROR] Error in streamText:", error);
      console.error(
        "[BROWSER USE WORKER:ERROR] Error stack:",
        error instanceof Error ? error.stack : "No stack"
      );
      console.error(
        "[BROWSER USE WORKER:ERROR] Error details:",
        JSON.stringify(error, null, 2)
      );
      throw error;
    }
  }
}
