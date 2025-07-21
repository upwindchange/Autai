import express from 'express';
import cors from 'cors';
import { createOpenAI } from "@ai-sdk/openai";
import { convertToCoreMessages, streamText } from "ai";
import { settingsService } from "./settingsService";

export class ApiServer {
  private app: express.Express;
  private server: any = null;
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
    this.app.post('/api/chat', async (req, res) => {
      try {
        const { messages, taskId } = req.body;
        
        // Get settings
        const settings = settingsService.getActiveSettings();
        if (!settings?.apiKey) {
          return res.status(400).json({ error: 'API key not configured' });
        }

        // Create OpenAI provider
        const openai = createOpenAI({
          apiKey: settings.apiKey,
          baseURL: settings.apiUrl || undefined,
        });

        // Stream the response
        const result = streamText({
          model: openai(settings.simpleModel || "gpt-4o-mini"),
          messages: convertToCoreMessages(messages),
          system: `You are a helpful AI assistant integrated into a web browser automation tool. 
                   You can help users navigate web pages, answer questions about the current page content, 
                   and provide assistance with browser automation tasks.
                   ${taskId ? `Current task ID: ${taskId}` : ''}`,
        });

        // Convert to data stream response
        const response = await result.toDataStreamResponse();
        
        // Set appropriate headers for streaming
        res.setHeader('Content-Type', response.headers.get('Content-Type') || 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        // Stream the response body
        const reader = response.body?.getReader();
        if (reader) {
          const decoder = new TextDecoder();
          
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(decoder.decode(value, { stream: true }));
          }
        }
        
        res.end();
      } catch (error) {
        console.error('Chat API error:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', port: this.port });
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