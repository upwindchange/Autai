import express, { type Express } from "express";
import cors from "cors";
import { pipeDataStreamToResponse } from "ai";
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
    // Chat endpoint
    this.app.post("/chat", async (req, res) => {
      try {
        const { messages, taskId, toolChoice } = req.body;
        console.log("[CHAT] Request received:", {
          messagesCount: messages?.length,
          taskId,
          toolChoice,
        });

        // Stream the response using pipeDataStreamToResponse
        console.log("[CHAT] Starting stream response...");
        pipeDataStreamToResponse(res, {
          execute: async (dataStreamWriter) => {
            try {
              await agentHandler.handleChat(
                { messages, taskId, toolChoice },
                dataStreamWriter
              );
            } catch (error) {
              console.error("[CHAT:ERROR] Error handling chat:", error);
              if (error instanceof Error && error.message === "API key not configured") {
                // This error is already handled by throwing in agentHandler
                throw error;
              }
              // Write an error message to the data stream for other errors
              dataStreamWriter.writeData({
                type: "error",
                error:
                  error instanceof Error
                    ? error.message
                    : "An unknown error occurred",
              });
            }
          },
          onError: (error) => {
            console.error("[CHAT:STREAM:ERROR] Stream error:", error);
            console.error(
              "[CHAT:STREAM:ERROR] Error type:",
              error?.constructor?.name
            );
            console.error(
              "[CHAT:STREAM:ERROR] Error details:",
              JSON.stringify(error, null, 2)
            );
            if (error instanceof Error) {
              console.error("[CHAT:STREAM:ERROR] Stack:", error.stack);
            }
            return error instanceof Error ? error.message : String(error);
          },
        });
      } catch (error) {
        console.error("[CHAT:CATCH] Outer error:", error);
        console.error(
          "[CHAT:CATCH] Error stack:",
          error instanceof Error ? error.stack : "No stack"
        );
        
        // Check for specific errors
        if (error instanceof Error && error.message === "API key not configured") {
          res.status(400).json({ error: "API key not configured" });
        } else {
          res.status(500).json({ error: "Internal server error" });
        }
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
