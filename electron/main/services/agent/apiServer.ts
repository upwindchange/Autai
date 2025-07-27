import express, { type Express } from "express";
import cors from "cors";
import { createOpenAI } from "@ai-sdk/openai";
import { streamText, pipeDataStreamToResponse } from "ai";
import { settingsService } from "../SettingsService";
import { type Server } from "http";

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
        const { messages, taskId } = req.body;

        // Get settings
        const settings = settingsService.getActiveSettings();
        if (!settings?.apiKey) {
          return res.status(400).json({ error: "API key not configured" });
        }

        // Create OpenAI provider
        const openai = createOpenAI({
          apiKey: settings.apiKey,
          baseURL: settings.apiUrl || undefined,
        });

        // Stream the response using pipeDataStreamToResponse
        pipeDataStreamToResponse(res, {
          execute: async (dataStreamWriter) => {
            const result = streamText({
              model: openai(settings.simpleModel || "gpt-4o-mini"),
              messages,
              system: `You are a helpful AI assistant integrated into a web browser automation tool. 
                       You can help users navigate web pages, answer questions about the current page content, 
                       and provide assistance with browser automation tasks.
                       ${taskId ? `Current task ID: ${taskId}` : ""}`,
            });

            result.mergeIntoDataStream(dataStreamWriter);
          },
          onError: (error) => {
            console.error("Chat API error:", error);
            return error instanceof Error ? error.message : String(error);
          },
        });
      } catch (error) {
        console.error("Chat API error:", error);
        res.status(500).json({ error: "Internal server error" });
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