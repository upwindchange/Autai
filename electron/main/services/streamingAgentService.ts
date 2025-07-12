import { ChatOpenAI } from "@langchain/openai";
import { InMemoryChatMessageHistory } from "@langchain/core/chat_history";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { settingsService } from "./settingsService";
import type {
  StreamingAgentConfig,
  AgentStreamOptions,
  StreamChunk,
} from "../../shared/types/streaming";

/**
 * Streaming-enabled AI agent service for task-specific conversations.
 * Each instance maintains its own conversation history.
 */
export class StreamingAgentService {
  private model: ChatOpenAI | null = null;
  private memory: InMemoryChatMessageHistory;
  private taskId: string;
  private config: StreamingAgentConfig;

  constructor(config: StreamingAgentConfig) {
    this.taskId = config.taskId;
    this.config = config;
    this.memory = new InMemoryChatMessageHistory();
  }

  /**
   * Creates a ChatOpenAI model instance with streaming enabled
   */
  private getModel(useComplexModel: boolean = false): ChatOpenAI {
    const settings = settingsService.getActiveSettings();

    if (!settings || !settings.apiKey) {
      throw new Error(
        "AI settings not configured. Please configure your API settings first."
      );
    }

    // Use config overrides if provided, otherwise use settings
    const apiKey = this.config.apiKey || settings.apiKey;
    const apiUrl = this.config.apiUrl || settings.apiUrl;
    const modelName =
      this.config.model ||
      (useComplexModel ? settings.complexModel : settings.simpleModel);

    return new ChatOpenAI({
      temperature: 0,
      apiKey: apiKey,
      modelName: modelName,
      streaming: true, // Enable streaming
      configuration: {
        baseURL: apiUrl,
      },
    });
  }

  /**
   * Stream a message response with conversation context
   */
  async *streamMessage(
    options: AgentStreamOptions
  ): AsyncGenerator<StreamChunk> {
    try {
      // Get or create model
      this.model = this.getModel();

      // Add user message to memory
      await this.memory.addMessage(new HumanMessage(options.message));

      // Create prompt with context
      const prompt = ChatPromptTemplate.fromMessages([
        [
          "system",
          "You are a helpful AI assistant integrated into a web browser. You can help users navigate web pages, answer questions, and provide assistance with their tasks.",
        ],
        ...(options.context
          ? ([
              [
                "system",
                `Current context:
- Page URL: ${options.context.currentUrl || "Unknown"}
- Page Title: ${options.context.pageTitle || "Unknown"}
${
  options.context.interactableElements
    ? `- Interactive elements available: ${options.context.interactableElements.length}`
    : ""
}`,
              ],
            ] as const)
          : []),
        ["placeholder", "{chat_history}"],
        ["human", "{input}"],
      ]);

      // Get chat history
      const messages = await this.memory.getMessages();
      const chatHistory = messages.slice(0, -1); // Exclude the last message we just added

      // Create chain with streaming
      const chain = prompt.pipe(this.model).pipe(new StringOutputParser());

      // Stream the response
      let fullResponse = "";
      const stream = await chain.stream({
        chat_history: chatHistory,
        input: options.message,
      });

      for await (const chunk of stream) {
        fullResponse += chunk;
        yield {
          type: "token",
          content: chunk,
          metadata: {
            taskId: this.taskId,
          },
        };
      }

      // Add AI response to memory
      await this.memory.addMessage(new AIMessage(fullResponse));
    } catch (error) {
      console.error("Streaming error:", error);
      yield {
        type: "error",
        content:
          error instanceof Error ? error.message : "An unknown error occurred",
        metadata: {
          taskId: this.taskId,
        },
      };
    }
  }

  /**
   * Clear conversation history
   */
  async clearHistory(): Promise<void> {
    await this.memory.clear();
  }

  /**
   * Get conversation history
   */
  async getHistory() {
    return await this.memory.getMessages();
  }

  /**
   * Update agent configuration
   */
  updateConfig(config: Partial<StreamingAgentConfig>): void {
    this.config = { ...this.config, ...config };
    // Reset model to use new config
    this.model = null;
  }

  /**
   * Cleanup resources
   */
  cleanup(): void {
    this.memory.clear();
    this.model = null;
  }
}
