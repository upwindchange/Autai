import { type UIMessage, generateObject } from "ai";
import { z } from "zod";
import { createAIProvider } from "@agents/providers";
import { ChatWorker, BrowserUseWorker } from "@agents/workers";

export interface ChatRequest {
  messages: UIMessage[];
  system?: string;
  tools?: unknown;
}

const WorkerDecisionSchema = z.object({
  reasoning: z.string(),
  workerType: z.enum(["chat", "browser-use"]),
});

export class AgentHandler {
  private chatWorker: ChatWorker;
  private browserUseWorker: BrowserUseWorker;

  constructor() {
    this.chatWorker = new ChatWorker();
    this.browserUseWorker = new BrowserUseWorker();
  }

  async handleChat(request: ChatRequest): Promise<ReadableStream> {
    const { messages } = request;

    console.log(
      "[AGENT ORCHESTRATOR] Making worker decision based on messages:",
      {
        messagesCount: messages?.length,
        messages: JSON.stringify(messages, null, 2),
      }
    );

    // Use LLM to decide which worker to use
    const workerType = await this.decideWorkerType(messages);

    console.log("[AGENT ORCHESTRATOR] Routing request to worker:", workerType);

    // Route to appropriate worker based on LLM decision
    switch (workerType) {
      case "browser-use":
        return await this.browserUseWorker.handleChat(request);
      case "chat":
      default:
        return await this.chatWorker.handleChat(request);
    }
  }

  private async decideWorkerType(
    messages: UIMessage[]
  ): Promise<"chat" | "browser-use"> {
    try {
      const { object } = await generateObject({
        model: await createAIProvider("simple"),
        schema: WorkerDecisionSchema,
        system: `You are an expert at determining whether a user's request requires browser automation capabilities or can be handled with a standard chat response.
        
        Choose "browser-use" when the user wants to:
        - Navigate websites or web pages
        - Find information on specific websites
        - Interact with web page elements
        - Perform actions on websites (login, fill forms, click buttons, etc.)
        - Compare information across multiple websites
        - Extract specific data from web pages
        
        Choose "chat" when the user wants to:
        - Have a general conversation
        - Ask questions that don't require web browsing
        - Perform calculations or solve math problems
        - Get explanations or creative content
        - Discuss topics or concepts
        - Anything that can be answered without browsing the web`,
        prompt: `Based on this conversation, determine whether to use the browser automation worker or the standard chat worker:
        
${JSON.stringify(messages, null, 2)}`,
      });

      console.log("[AGENT ORCHESTRATOR] Worker decision:", object);
      return object.workerType;
    } catch (error) {
      console.error(
        "[AGENT ORCHESTRATOR:ERROR] Error deciding worker type:",
        error
      );
      // Default to chat worker if decision fails
      return "chat";
    }
  }
}

export const agentHandler = new AgentHandler();
