import { type UIMessage, type StreamTextResult } from "ai";
import { simpleLangchainModel } from "@agents/providers";
// import { ChatWorker, BrowserUseWorker } from "@agents/workers";
import { ChatWorker } from "@agents/workers";
import { sendAlert } from "@/utils";
import { settingsService } from "@/services";
import { type ChatRequest } from "@shared";
import log from "electron-log/main";
import { z } from "zod";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

export class AgentHandler {
  private chatWorker: ChatWorker;
  // private browserUseWorker: BrowserUseWorker;
  private logger = log.scope("AgentHandler");

  constructor() {
    this.chatWorker = new ChatWorker();
    // this.browserUseWorker = new BrowserUseWorker();
  }

  async handleChat(
    request: ChatRequest
  ): Promise<StreamTextResult<Record<string, any>, any>> {
    const { messages } = request;

    this.logger.debug("making worker decision", {
      messagesCount: messages?.length,
      firstMessageRole: messages?.[0]?.role,
    });

    // Use LLM to decide which worker to use
    const workerType = await this.decideWorkerType(messages);

    this.logger.info("routing to worker", { workerType });

    // Route to appropriate worker based on LLM decision
    // switch (workerType) {
    //   case "browser-use":
    //     return await this.browserUseWorker.handleChat(request);
    //   case "chat":
    //   default:
    //     return await this.chatWorker.handleChat(request);
    // }
    return await this.chatWorker.handleChat(request);
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
      this.logger.info(JSON.stringify(messages, null, 2));

      // Define the schema for structured output
      const workerDecisionSchema = z.object({
        mode: z.enum(["chat", "browser-use"]),
      });

      // Get the LangChain model
      const model = await simpleLangchainModel();

      // Create structured output model with function calling
      const structuredLlm = model.withStructuredOutput(workerDecisionSchema, {
        method: "functionCalling",
      });

      // Create system message
      const systemMessage = new SystemMessage(
        "You are an expert at determining whether a user's request requires browser" +
          " automation capabilities or can be handled with a standard chat response.\n\n" +
          'Choose "browser-use" when the user wants to:\n' +
          "- Navigate websites or web pages\n" +
          "- Find information on specific websites\n" +
          "- Interact with web page elements\n" +
          "- Perform actions on websites (login, fill forms, click buttons, etc.)\n" +
          "- Compare information across multiple websites\n" +
          "- Extract specific data from web pages\n\n" +
          'Choose "chat" when the user wants to:\n' +
          "- Have a general conversation\n" +
          "- Ask questions that don't require web browsing\n" +
          "- Perform calculations or solve math problems\n" +
          "- Get explanations or creative content\n" +
          "- Discuss topics or concepts\n" +
          "- Anything that can be answered without browsing the web"
      );

      // Create human message with the conversation
      const humanMessage = new HumanMessage(
        "Based on this conversation, determine whether to use the web browser automation " +
          "or the standard chat:\n\n" +
          `${JSON.stringify(messages, null, 2)}`
      );

      // Invoke the structured model
      const result = await structuredLlm.invoke([systemMessage, humanMessage]);

      this.logger.debug("worker decision made", { workerType: result });

      // Validate the returned value is one of our expected types
      const workerType = result.mode;
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
        `AI model "${modelName}" from provider "${providerName}" is unable to process advanced requests. ` +
          "Browser automation and AI agent features will be disabled. Tool usage may fail. " +
          "Please configure a model that supports advanced capabilities for optimal experience."
      );

      // Default to chat worker if decision fails
      return "chat";
    }
  }
}

export const agentHandler = new AgentHandler();
