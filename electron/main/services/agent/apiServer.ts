import express, { type Express } from "express";
import cors from "cors";
import { createUIMessageStreamResponse } from "ai";
import { type Server } from "http";
import { agentHandler } from "./agentHandler";

export class ApiServer {
  private app: Express;
  private server: Server | null = null;
  private port: number = 3001;

  constructor() {
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    // Enable CORS for all origins
    this.app.use(cors());

    // Parse JSON bodies
    this.app.use(express.json());
  }

  private setupRoutes(): void {
    // Add request logging middleware for debugging
    this.app.use((req, res, next) => {
      console.log(`[API] ${req.method} ${req.url}`);
      next();
    });

    // Chat endpoint
    this.app.post("/chat", async (req, res) => {
      try {
        const { messages, system, tools } = req.body;
        console.log("[CHAT] Request received:", {
          messagesCount: messages?.length,
          system,
          tools,
        });

        // Stream the response using createUIMessageStreamResponse
        console.log("[CHAT] Starting stream response...");
        try {
          const stream = await agentHandler.handleChat({
            messages,
            system,
            tools,
          });

          const response = createUIMessageStreamResponse({ stream });

          // Set headers from the Response object
          response.headers.forEach((value, key) => {
            res.setHeader(key, value);
          });

          // Pipe the stream to the Express response
          const reader = response.body?.getReader();
          if (!reader) {
            throw new Error("No response body");
          }

          const sendChunk = async () => {
            const { done, value } = await reader.read();
            if (done) {
              res.end();
              return;
            }
            res.write(value);
            await sendChunk();
          };

          await sendChunk();
        } catch (error) {
          console.error("[CHAT:ERROR] Error handling chat:", error);
          if (!res.headersSent) {
            if (
              error instanceof Error &&
              error.message === "API key not configured"
            ) {
              res.status(400).json({ error: "API key not configured" });
            } else {
              res.status(500).json({ error: "Internal server error" });
            }
          }
        }
      } catch (error) {
        console.error("[CHAT:CATCH] Outer error:", error);
        console.error(
          "[CHAT:CATCH] Error stack:",
          error instanceof Error ? error.stack : "No stack"
        );
      }
    });

    // Health check endpoint
    this.app.get("/health", (req, res) => {
      res.json({ status: "ok", port: this.port });
    });
  }

  start(): void {
    this.server = this.app.listen(this.port, () => {
      console.log(`API server running on http://localhost:${this.port}`);
    });
  }

  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  getPort(): number {
    return this.port;
  }
}

export const apiServer = new ApiServer();
