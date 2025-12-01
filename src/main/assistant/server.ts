import express, { Request, Response } from "express";
import cors from "cors";
import log from "electron-log/main";

const logger = log.scope("AssistantServer");
const app = express();
const PORT = 3002;
let server: any = null;

// Middleware
app.use(cors());
app.use(express.json());

// Chat endpoint with streaming echo response and tool calling POC
app.post("/chat", async (req: Request, res: Response) => {
  try {
    const { messages, tools } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: "Invalid messages format" });
      return;
    }

    // Get the last user message
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage || lastMessage.role !== "user") {
      res.status(400).json({ error: "No user message found" });
      return;
    }

    // Extract text from user message content
    let userText = "";
    if (Array.isArray(lastMessage.content)) {
      userText = lastMessage.content
        .filter((item: any) => item.type === "text")
        .map((item: any) => item.text)
        .join(" ");
    } else if (typeof lastMessage.content === "string") {
      userText = lastMessage.content;
    }

    if (!userText) {
      res.status(400).json({ error: "No text content found in user message" });
      return;
    }

    // Check if user wants to use tools and tools are available
    const shouldUseTools = tools && tools.length > 0 && (
      userText.toLowerCase().includes("add") ||
      userText.toLowerCase().includes("calculate") ||
      userText.toLowerCase().includes("sum") ||
      userText.toLowerCase().includes("plus")
    );

    logger.info("Tool check:", {
      userText,
      toolsCount: tools?.length,
      shouldUseTools,
      tools
    });

    const responseContent: Array<{
      type: "tool-call";
      toolCallId: string;
      toolName: string;
      args: { a: number; b: number };
    }> = [];

    if (shouldUseTools) {
      // Find the add tool
      const addTool = tools.find((tool: { type: string; function?: { name: string } }) =>
        tool.type === "function" && tool.function?.name === "add"
      );

      if (addTool) {
        // Generate dummy tool call for POC
        const toolCallId = "call_" + Math.random().toString(36).substring(2, 11);

        // Extract numbers from user text for more realistic demo
        const numbers = userText.match(/\d+/g);
        const a = numbers && numbers.length >= 1 ? parseInt(numbers[0]) : 5;
        const b = numbers && numbers.length >= 2 ? parseInt(numbers[1]) : 3;

        const toolCall = {
          type: "tool-call" as const,
          toolCallId,
          toolName: "add",
          args: { a, b }
        };

        responseContent.push(toolCall);
        logger.info(`Generated tool call: ${toolCall.toolName}(${a}, ${b})`);
      }
    }

    // If no tool calls were generated, do echo response
    if (responseContent.length === 0) {
      // Create streaming response for text
      const stream = new ReadableStream({
        async start(controller) {
          try {
            // Echo the message character by character with delays
            for (let i = 0; i < userText.length; i++) {
              const char = userText[i];
              controller.enqueue(new TextEncoder().encode(char));

              // Small delay between characters to simulate streaming
              await new Promise(resolve => setTimeout(resolve, 50));
            }

            controller.close();
          } catch (error) {
            controller.error(error);
          }
        }
      });

      // Set headers for streaming response
      res.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8",
        "Transfer-Encoding": "chunked",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive"
      });

      // Pipe the stream to the response
      const reader = stream.getReader();

      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          res.write(value);
        }

        res.end();
      } catch (_error) {
        res.status(500).json({ error: "Streaming error" });
      }
    } else {
      // Return tool calls as JSON (non-streaming for simplicity)
      res.json({ content: responseContent });
    }

  } catch (error) {
    logger.error("Chat endpoint error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Health check endpoint
app.get("/health", (req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Start server function
function start() {
  if (server) {
    logger.info("Assistant server is already running");
    return;
  }

  server = app.listen(PORT, () => {
    logger.info(`Assistant API server running on port ${PORT}`);
  });
}

// Stop server function
function stop() {
  if (!server) {
    logger.info("Assistant server is not running");
    return;
  }

  return new Promise<void>((resolve) => {
    server.close(() => {
      logger.info("Assistant server stopped");
      server = null;
      resolve();
    });
  });
}

export default {
  start,
  stop,
};