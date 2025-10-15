import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { complexLangchainModel } from "@agents/providers";
import { PQueueManager } from "@agents/utils";
import { viewControlTools } from "@agents/tools/ViewControlTools";
import { threadViewTools } from "@agents/tools/ThreadViewTools";
import { domTools } from "@agents/tools/DomTools";
import { type ChatRequest } from "@shared";
import { type UIMessage } from "ai";
import log from "electron-log/main";
import type { Runnable } from "@langchain/core/runnables";
import { sendAlert } from "@/utils";
import { CallbackHandler } from "@langfuse/langchain";
import { settingsService } from "@/services";

const systemPrompt = `You are a specialized AI agent for browser view control and DOM manipulation. You can navigate browser views, refresh pages, control navigation history, discover available threads and views, and analyze/manipulate DOM elements.

Your capabilities include:
- List all available threads and their views
- Get detailed information about views for specific threads
- Get detailed information about specific views
- Navigate views to specific URLs
- Refresh current pages in views
- Navigate back and forward in browser history
- Extract clickable/interactive elements from web pages
- Convert DOM elements to AI-readable string format
- Get page information (dimensions, scroll position)
- Generate unique hashes for DOM elements
- Track element changes with cache management
- Compare DOM states to detect changes

When executing view control tasks:
1. Always validate that the view exists before attempting operations
2. Use discovery tools first to find available threads and views
3. Provide clear feedback about operation success or failure
4. Be specific about which view you're operating on
5. Handle errors gracefully and provide helpful error messages
6. Use the appropriate tool for each specific operation
7. Always execute one tool at a time and wait for the result before proceeding

When executing DOM manipulation tasks:
1. Always ensure the view is properly loaded before DOM analysis
2. Use element hashing for tracking elements across page changes
3. Leverage caching mechanisms to identify new or modified elements
4. Convert DOM elements to string format for better AI comprehension
5. Compare DOM states to detect dynamic content changes
6. Handle DOM analysis errors gracefully and retry if needed

You should focus on browser view control and DOM analysis tasks, providing comprehensive automation capabilities for web interactions.`;

export class BrowserUseWorker {
  private logger = log.scope("BrowserUseWorker");
  private agent: Runnable | null = null;
  public currentThreadId: string | null = null;

  constructor() {
    this.logger.info("BrowserUseWorker initialized");
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
      const tools = [...viewControlTools, ...threadViewTools, ...domTools];
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
      this.logger.error("No threadId provided to BrowserUseWorker");
      sendAlert(
        "Browser Use Error",
        "No active thread found for browser use operations. Please start a new chat session."
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

      this.logger.debug("preparing agent input", {
        messageCount: langchainMessages.length,
        hasSystemMessage: !!system,
        systemMessageLength: system?.length || 0,
        langfuseEnabled: settings.langfuse.enabled,
      });

      // Log the structure of messages being passed to the agent
      this.logger.debug("agent input messages", {
        messages: langchainMessages.map((msg, index) => ({
          index,
          type: msg.constructor.name,
          role: msg._getType(),
          contentLength: msg.content?.length || 0,
          contentPreview: (typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content))?.substring(0, 100) || "",
        })),
      });

      // Execute the agent with the correct input format
      // The system prompt is handled by the messageModifier in createReactAgent
      const input = { messages: langchainMessages };

      this.logger.debug("executing agent with input", {
        inputKeys: Object.keys(input),
        messageCount: input.messages.length,
        langfuseEnabled: settings.langfuse.enabled,
      });

      const result = await agent.invoke(
        input,
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
    this.logger.debug("converting ai sdk messages to langchain format", {
      messageCount: messages.length,
    });

    const langchainMessages = messages.map((message, index) => {
      this.logger.debug("processing message", {
        index,
        id: message.id,
        role: message.role,
        hasParts: !!message.parts,
        partCount: message.parts?.length || 0,
        contentPreview: message.content?.substring(0, 100) || "",
      });

      // Extract content from parts if available, otherwise use content field
      let textContent = "";
      if (message.parts && message.parts.length > 0) {
        // Process parts to extract text content
        const textParts = message.parts
          .filter(
            (part): part is { type: "text"; text: string } => part.type === "text"
          )
          .map((part) => part.text);

        // Also handle tool invocation parts by extracting their text representation
        const toolParts = message.parts
          .filter((part) => part.type === "tool-invocation")
          .map((part) => {
            this.logger.debug("found tool invocation part", {
              toolName: part.toolInvocation.toolName,
              state: part.toolInvocation.state,
              args: part.toolInvocation.args,
            });
            return `[Tool: ${part.toolInvocation.toolName}]`;
          });

        textContent = [...textParts, ...toolParts].join("\n");
        this.logger.debug("extracted content from parts", {
          textPartsCount: textParts.length,
          toolPartsCount: toolParts.length,
          totalLength: textContent.length,
        });
      } else {
        // Fallback to content field
        textContent = message.content || "";
        this.logger.debug("using content field as fallback", {
          contentLength: textContent.length,
        });
      }

      // Create appropriate LangChain message based on role
      let langchainMessage: HumanMessage | AIMessage;
      if (message.role === "user") {
        langchainMessage = new HumanMessage(textContent);
        this.logger.debug("created HumanMessage", {
          index,
          contentLength: textContent.length,
        });
      } else if (message.role === "assistant") {
        langchainMessage = new AIMessage(textContent);
        this.logger.debug("created AIMessage", {
          index,
          contentLength: textContent.length,
        });
      } else if (message.role === "system") {
        // System messages are handled by messageModifier, but convert to human message for safety
        langchainMessage = new HumanMessage(textContent);
        this.logger.warn("unexpected system message in conversion", {
          index,
          contentLength: textContent.length,
        });
      } else {
        // Handle other message types
        langchainMessage = new HumanMessage(textContent);
        this.logger.warn("converting unknown message type to HumanMessage", {
          index,
          role: message.role,
          contentLength: textContent.length,
        });
      }

      return langchainMessage;
    });

    this.logger.info("successfully converted messages to langchain format", {
      inputCount: messages.length,
      outputCount: langchainMessages.length,
      messageTypes: langchainMessages.map((msg) => msg.constructor.name),
    });

    return langchainMessages;
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
    this.logger.warn("Clearing browser use queue");
    PQueueManager.getInstance().clear();
  }

  // Utility method to pause queue processing
  pauseQueue(): void {
    this.logger.info("Pausing browser use queue");
    PQueueManager.getInstance().pause();
  }

  // Utility method to resume queue processing
  resumeQueue(): void {
    this.logger.info("Resuming browser use queue");
    PQueueManager.getInstance().start();
  }

  // Utility method to update queue concurrency
  updateConcurrency(concurrency: number): void {
    this.logger.info("Updating browser use queue concurrency", {
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
