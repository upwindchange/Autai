import type {
  ChatModelAdapter,
  ChatModelRunResult,
  ModelContext,
  ThreadMessage,
} from "@assistant-ui/react";
import log from "electron-log/renderer";

const logger = log.scope("LocalChatAdapter");

export const LocalChatAdapter: ChatModelAdapter = {
  async *run({ messages, abortSignal, context }: { messages: readonly ThreadMessage[]; abortSignal: AbortSignal; context: ModelContext }) {
    try {
      logger.info("LocalChatAdapter starting:", {
        messagesCount: messages.length,
        lastMessage: messages[messages.length - 1]?.content,
        hasTools: !!context.tools,
        toolsCount: context.tools?.length || 0,
        tools: context.tools
      });

      // Prepare request body
      const requestBody = {
        messages: messages.map(msg => ({
          role: msg.role,
          content: msg.content
        })),
        tools: context.tools || []
      };

      // Make request to our Express server
      const response = await fetch("http://localhost:3002/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
        signal: abortSignal,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      if (!response.body) {
        throw new Error("Response body is null");
      }

      // Check if the response is JSON (tool calls) or streaming (text)
      const contentType = response.headers.get("content-type");
      logger.info("Response content type:", contentType);

      if (contentType && contentType.includes("application/json")) {
        // Parse JSON response for tool calls
        const jsonResponse = await response.json();
        logger.info("Tool call response:", jsonResponse);
        if (jsonResponse.content && Array.isArray(jsonResponse.content)) {
          logger.info("Yielding tool call content:", jsonResponse.content);
          yield {
            content: jsonResponse.content,
          };
        }
      } else {
        // Handle streaming text response
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let accumulatedText = "";

        try {
          while (true) {
            const { done, value } = await reader.read();

            if (done) {
              break;
            }

            // Decode the chunk and accumulate text
            const chunk = decoder.decode(value, { stream: true });
            accumulatedText += chunk;

            // Yield the current accumulated text
            yield {
              content: [
                {
                  type: "text" as const,
                  text: accumulatedText,
                },
              ],
            };
          }
        } finally {
          reader.releaseLock();
        }
      }

    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        // User cancelled the request - this is normal
        logger.info("Request aborted by user");
        return;
      }

      logger.error("LocalChatAdapter error:", error);
      throw error;
    }
  },
};