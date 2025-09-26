import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { complexLangchainModel } from "@agents/providers";
import { PQueueManager } from "@/agents/queue/PQueueManager";
import { viewControlTools } from "@/agents/tools/ViewControlTools";
import { type ChatRequest } from "@shared";
import log from "electron-log/main";

const systemPrompt = `You are a specialized AI agent for browser view control. You can navigate browser views, refresh pages, and control navigation history.

Your capabilities include:
- Navigate views to specific URLs
- Refresh current pages in views
- Navigate back and forward in browser history

When executing view control tasks:
1. Always validate that the view exists before attempting operations
2. Provide clear feedback about operation success or failure
3. Be specific about which view you're operating on
4. Handle errors gracefully and provide helpful error messages
5. Use the appropriate tool for each specific operation
6. Always execute one tool at a time and wait for the result before proceeding

You should focus exclusively on browser view control tasks and avoid performing other types of operations.`;

export class ViewControlWorker {
  private logger = log.scope("ViewControlWorker");
  private agent: any = null;

  constructor() {
    this.logger.info("ViewControlWorker initialized");
  }

  private async initializeAgent(): Promise<any> {
    if (this.agent) {
      return this.agent;
    }

    this.logger.debug("Initializing LangChain React agent");

    try {
      // Get the language model provider and model
      const model = await complexLangchainModel();

      // Get the tools
      const tools = viewControlTools;
      this.logger.debug("Using tools", {
        count: tools.length,
        toolNames: tools.map((tool: any) => tool.name),
      });

      // Create the React agent using LangGraph
      this.agent = createReactAgent({
        llm: model,
        tools,
        messageModifier: systemPrompt,
      });

      this.logger.info("LangChain React agent initialized successfully");
      return this.agent;
    } catch (error) {
      this.logger.error("Failed to initialize LangChain React agent", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  async handleChat(request: ChatRequest): Promise<ReadableStream> {
    const { messages, system, requestId } = request;
    this.logger.debug("Request received", {
      messagesCount: messages?.length,
      hasSystem: !!system,
      requestId,
    });

    try {
      // Convert messages to LangChain format
      const langchainMessages = this.convertToLangchainMessages(messages);

      // Initialize agent if not already done
      const agent = await this.initializeAgent();

      // Prepare the input with system prompt
      const input = {
        messages: [
          ...(system
            ? [
                {
                  role: "system" as const,
                  content: `${systemPrompt} ${system}`,
                },
              ]
            : []),
          ...langchainMessages,
        ],
      };

      this.logger.debug("Executing agent", {
        messageCount: input.messages.length,
        lastMessage: input.messages[input.messages.length - 1]?.content,
      });

      // Execute the agent
      const result = await agent.invoke(input);

      this.logger.debug("Agent execution completed", {
        messagesCount: result.messages?.length || 0,
      });

      // Create a readable stream from the result
      return this.createResultStream(result);
    } catch (error) {
      this.logger.error("Failed to execute agent", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  private convertToLangchainMessages(
    messages: any[]
  ): Array<HumanMessage | AIMessage> {
    return messages.map((message) => {
      if (message.role === "user") {
        return new HumanMessage(message.content);
      } else if (message.role === "assistant") {
        return new AIMessage(message.content);
      } else {
        // Handle other message types or convert to appropriate format
        return new HumanMessage(String(message.content));
      }
    });
  }

  private createResultStream(result: any): ReadableStream {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        try {
          // Extract the final response from the agent result
          const finalMessage = result.messages[result.messages.length - 1];
          const content = finalMessage?.content || "No response generated";

          // Send the result as a single chunk
          const chunk = encoder.encode(
            JSON.stringify({
              type: "response",
              content: content,
              messages: result.messages,
            }) + "\n"
          );

          controller.enqueue(chunk);
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });

    return stream;
  }

  // Utility method to get current queue status
  async getQueueStatus(): Promise<{
    size: number;
    pending: number;
    concurrency: number;
    isPaused: boolean;
  }> {
    return PQueueManager.getInstance().getStatus();
  }

  // Utility method to wait for queue to be idle
  async waitForIdle(): Promise<void> {
    return PQueueManager.getInstance().onIdle();
  }

  // Utility method to clear the queue (emergency use only)
  async clearQueue(): Promise<void> {
    this.logger.warn("Clearing view control queue");
    PQueueManager.getInstance().clear();
  }

  // Utility method to pause queue processing
  pauseQueue(): void {
    this.logger.info("Pausing view control queue");
    PQueueManager.getInstance().pause();
  }

  // Utility method to resume queue processing
  resumeQueue(): void {
    this.logger.info("Resuming view control queue");
    PQueueManager.getInstance().start();
  }

  // Utility method to update queue concurrency
  updateConcurrency(concurrency: number): void {
    this.logger.info("Updating view control queue concurrency", {
      concurrency,
    });
    PQueueManager.getInstance().updateConcurrency(concurrency);
  }

  // Reset agent (useful for testing or reconfiguration)
  resetAgent(): void {
    this.logger.info("Resetting agent");
    this.agent = null;
  }
}
