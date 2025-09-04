import express, { type Express } from "express";
import cors from "cors";
import { createUIMessageStreamResponse } from "ai";
import { type Server } from "http";
import { agentHandler } from "@agents";
import { createLogger } from "@backend/services";

export class ApiServer {
  private app: Express;
  private server: Server | null = null;
  private port: number = 3001;
  private logger = createLogger('ApiServer');

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
      this.logger.debug(`${req.method} ${req.url}`);
      next();
    });

    // Chat endpoint
    this.app.post("/chat", async (req, res) => {
      try {
        const { messages, system, tools } = req.body;
        this.logger.info("Chat request received", {
          messagesCount: messages?.length,
          hasSystem: !!system,
          hasTools: !!tools,
        });

        // Stream the response using createUIMessageStreamResponse
        this.logger.debug("Starting stream response...");
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
          this.logger.error("Error handling chat:", error);
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
        this.logger.error("Outer error in chat handler:", {
          error,
          stack: error instanceof Error ? error.stack : "No stack"
        });
      }
    });

    // Health check endpoint
    this.app.get("/health", (req, res) => {
      res.json({ status: "ok", port: this.port });
    });
  }

  start(): void {
    this.server = this.app.listen(this.port, () => {
      this.logger.info(`API server running on http://localhost:${this.port}`);
    });
  }

  stop(): void {
    if (this.server) {
      try {
        this.logger.info("Closing API server...");
        this.server.close((err) => {
          if (err) {
            this.logger.error("Error closing API server:", err);
          } else {
            this.logger.info("API server closed successfully");
          }
        });
        
        // Force close after 1 second if it hasn't closed gracefully
        setTimeout(() => {
          if (this.server) {
            this.server.close(() => {});
            this.server = null;
            this.logger.warn("API server force closed");
          }
        }, 1000);
      } catch (error) {
        this.logger.error("Error stopping API server:", error);
        this.server = null; // Ensure we clear the reference even if there's an error
      }
    } else {
      this.logger.debug("API server already stopped or not initialized");
    }
  }

  getPort(): number {
    return this.port;
  }
}

export const apiServer = new ApiServer();
