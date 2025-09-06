import { type UIMessage, generateObject } from "ai";
import { simpleModel } from "@agents/providers";
import { ChatWorker, BrowserUseWorker } from "@agents/workers";
import { sendAlert } from "@backend/utils";
import { settingsService } from "@backend/services";
import log from "electron-log/main";

export interface ChatRequest {
  messages: UIMessage[];
  system?: string;
  tools?: unknown;
}

export class AgentHandler {
  private chatWorker: ChatWorker;
  private browserUseWorker: BrowserUseWorker;
  private logger = log.scope('AgentHandler');

  constructor() {
    this.chatWorker = new ChatWorker();
    this.browserUseWorker = new BrowserUseWorker();
  }

  async handleChat(request: ChatRequest): Promise<ReadableStream> {
    const { messages } = request;

    this.logger.debug("making worker decision", {
      messagesCount: messages?.length,
      firstMessageRole: messages?.[0]?.role
    });

    // Use LLM to decide which worker to use
    const workerType = await this.decideWorkerType(messages);

    this.logger.info("routing to worker", { workerType });

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
    const settings = settingsService.settings;
    const simpleConfig = settings.modelConfigurations.simple;

    // Check if the model supports advanced usage
    if (!simpleConfig.supportsAdvancedUsage) {
      this.logger.debug("model lacks advanced capabilities, using chat worker");
      return "chat";
    }

    try {
      const { object } = await generateObject({
        model: await simpleModel(),
        output: "enum",
        enum: ["chat", "browser-use"],
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

      this.logger.debug("worker decision made", { workerType: object });
      
      // Validate the returned value is one of our expected types
      const workerType = object as string;
      if (workerType !== "chat" && workerType !== "browser-use") {
        this.logger.error("invalid worker type", { workerType });
        return "chat"; // default fallback
      }
      return workerType as "chat" | "browser-use";
    } catch (error) {
      this.logger.error("failed to decide worker type", error);

      // Get provider and model info for better error message
      const providerName = simpleConfig.providerName || simpleConfig.providerId;
      const modelName = simpleConfig.modelName;

      // Update capability setting and persist to storage
      await settingsService.updateModelAdvancedCapability("simple", false);

      sendAlert(
        "Model capability alert",
        `AI model "${modelName}" from provider "${providerName}" is unable to process advanced requests. Browser automation and AI agent features will be disabled. Tool usage may fail. Please configure a model that supports advanced capabilities for optimal experience.`
      );

      // Default to chat worker if decision fails
      return "chat";
    }
  }
}

export const agentHandler = new AgentHandler();
