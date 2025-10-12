import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { complexLangchainModel } from "@agents/providers";
import { PQueueManager } from "@agents/utils";
import { viewControlTools } from "@agents/tools/ViewControlTools";
import { threadViewTools } from "@agents/tools/ThreadViewTools";
import { type ChatRequest } from "@shared";
import { type UIMessage } from "ai";
import log from "electron-log/main";
import type { Runnable } from "@langchain/core/runnables";
import { sendAlert } from "@/utils";
import { CallbackHandler } from "@langfuse/langchain";
import { settingsService } from "@/services";

const systemPrompt = `You are a specialized AI agent for browser view control. You can navigate browser views, refresh pages, control navigation history, and discover available threads and views.

Your capabilities include:
- List all available threads and their views
- Get detailed information about views for specific threads
- Get detailed information about specific views
- Navigate views to specific URLs
- Refresh current pages in views
- Navigate back and forward in browser history

When executing view control tasks:
1. Always validate that the view exists before attempting operations
2. Use discovery tools first to find available threads and views
3. Provide clear feedback about operation success or failure
4. Be specific about which view you're operating on
5. Handle errors gracefully and provide helpful error messages
6. Use the appropriate tool for each specific operation
7. Always execute one tool at a time and wait for the result before proceeding

You should focus exclusively on browser view control tasks and avoid performing other types of operations.`;

export class ViewControlWorker {
  private logger = log.scope("ViewControlWorker");
  private agent: Runnable | null = null;
  public currentThreadId: string | null = null;

  constructor() {
    this.logger.info("ViewControlWorker initialized");
  }

  private async initializeAgent(): Promise<Runnable> {
    if (this.agent) {
      return this.agent;
    }

    this.logger.debug("Initializing LangChain React agent");

    try {
      // Get the language model provider and model
      const model = await complexLangchainModel();

      // Get the tools
      const tools = [...viewControlTools, ...threadViewTools];
      this.logger.debug("Using tools", {
        count: tools.length,
        toolNames: tools.map((tool) => tool.name),
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
    const { messages, system, threadId } = request;
    this.logger.debug("Request received", {
      messagesCount: messages?.length,
      hasSystem: !!system,
      threadId,
    });

    // Ensure we have a threadId - this should always exist when chat is started
    if (!threadId) {
      this.logger.error("No threadId provided to ViewControlWorker");
      sendAlert(
        "View Control Error",
        "No active thread found for view control operations. Please start a new chat session."
      );
      // Return empty stream
      return new ReadableStream({
        start(controller) {
          controller.close();
        },
      });
    }

    this.logger.debug("Using thread ID for operations", {
      threadId,
    });

    // Store the current thread ID for this worker instance
    this.currentThreadId = threadId;

    const settings = settingsService.settings;
    // Conditionally create the langfuse handler based on settings
    const langfuseHandler = settings.langfuse.enabled
      ? new CallbackHandler({
          sessionId: threadId,
          tags: ["langchain-test"],
        })
      : undefined;

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
        langfuseEnabled: settings.langfuse.enabled,
      });

      // Execute the agent with conditional callbacks
      const result = await agent.invoke(
        { input },
        langfuseHandler ? { callbacks: [langfuseHandler] } : {}
      );

      this.logger.debug("Agent execution completed", {
        messagesCount: result.messages?.length || 0,
      });

      // Create a readable stream from the result
      return this.createResultStream(result);
    } catch (error) {
      this.logger.error("Agent execution failed", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        threadId: this.currentThreadId,
      });

      // Re-throw the error to let the caller handle it
      throw error;
    }
  }

  private convertToLangchainMessages(
    messages: UIMessage[]
  ): Array<HumanMessage | AIMessage> {
    return messages.map((message) => {
      // Extract text content from message parts
      const textContent = message.parts
        .filter(
          (part): part is { type: "text"; text: string } => part.type === "text"
        )
        .map((part) => part.text)
        .join("\n");

      if (message.role === "user") {
        return new HumanMessage(textContent);
      } else if (message.role === "assistant") {
        return new AIMessage(textContent);
      } else {
        // Handle other message types or convert to appropriate format
        return new HumanMessage(textContent);
      }
    });
  }

  private createResultStream(result: {
    messages: Array<HumanMessage | AIMessage>;
  }): ReadableStream {
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
