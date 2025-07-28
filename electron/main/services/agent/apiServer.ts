import express, { type Express } from "express";
import cors from "cors";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText, generateText, pipeDataStreamToResponse, tool } from "ai";
import { z } from "zod";
import * as mathjs from "mathjs";
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
        const { messages, taskId, toolChoice } = req.body;

        // Get settings
        const settings = settingsService.getActiveSettings();
        if (!settings?.apiKey) {
          return res.status(400).json({ error: "API key not configured" });
        }

        // Create OpenAI-compatible provider
        const provider = createOpenAICompatible({
          name: "openai",
          apiKey: settings.apiKey,
          baseURL: settings.apiUrl || "https://api.openai.com/v1",
        });
        
        console.log("API Settings:", {
          model: settings.simpleModel || "gpt-4o-mini",
          hasApiKey: !!settings.apiKey,
          baseURL: settings.apiUrl || "default",
          provider: "openai-compatible"
        });

        // Stream the response using pipeDataStreamToResponse
        pipeDataStreamToResponse(res, {
          execute: async (dataStreamWriter) => {
            try {
              const result = streamText({
                model: provider(settings.simpleModel || "gpt-4o-mini"), // Use configured model or fallback
                messages,
                system: `You are a helpful AI assistant integrated into a web browser automation tool. 
                         You can help users navigate web pages, answer questions about the current page content, 
                         and provide assistance with browser automation tasks.
                         You have access to a calculator tool for evaluating mathematical expressions.
                         When solving math problems, reason step by step and use the calculator when necessary.
                         ${taskId ? `Current task ID: ${taskId}` : ""}`,
                maxSteps: 10, // Enable multi-step tool calling
                tools: {
                  calculate: tool({
                    description:
                      "A tool for evaluating mathematical expressions. " +
                      "Example expressions: " +
                      "'1.2 * (2 + 4.5)', '12.7 cm to inch', 'sin(45 deg) ^ 2'.",
                    parameters: z.object({ expression: z.string() }),
                    execute: async ({ expression }) => {
                      try {
                        console.log("Calculator tool called with expression:", expression);
                        const result = mathjs.evaluate(expression);
                        console.log("Calculation result:", result);
                        return result;
                      } catch (error) {
                        console.error("Calculator error:", error);
                        return `Error evaluating expression: ${error instanceof Error ? error.message : String(error)}`;
                      }
                    },
                  }),
                  // answer tool: the LLM will provide a structured answer
                  answer: tool({
                    description: "A tool for providing the final answer.",
                    parameters: z.object({
                      steps: z.array(
                        z.object({
                          calculation: z.string(),
                          reasoning: z.string(),
                        }),
                      ),
                      answer: z.string(),
                    }),
                    // no execute function - invoking it will terminate the agent
                  }),
                },
                toolChoice: toolChoice || undefined, // Add toolChoice support
                onStepFinish({ text, toolCalls, toolResults, finishReason, usage }) {
                  console.log("Step finished (streaming):", {
                    text,
                    toolCalls: toolCalls?.map(tc => ({ name: tc.toolName, args: tc.args })),
                    toolResults,
                    finishReason,
                    usage,
                  });
                  // You can also write step information to the data stream if needed
                  dataStreamWriter.writeData({
                    type: 'step-finished',
                    step: {
                      text,
                      toolCalls,
                      toolResults,
                      finishReason,
                      usage,
                    },
                  });
                },
              });

              result.mergeIntoDataStream(dataStreamWriter);
            } catch (error) {
              console.error("Error in streamText:", error);
              // Write an error message to the data stream
              dataStreamWriter.writeData({
                type: 'error',
                error: error instanceof Error ? error.message : 'An unknown error occurred'
              });
            }
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

    // Chat with steps endpoint - demonstrates accessing all steps
    this.app.post("/chat-with-steps", async (req, res) => {
      try {
        const { messages, taskId, toolChoice } = req.body;

        // Get settings
        const settings = settingsService.getActiveSettings();
        if (!settings?.apiKey) {
          return res.status(400).json({ error: "API key not configured" });
        }

        // Create OpenAI-compatible provider
        const provider = createOpenAICompatible({
          name: "openai",
          apiKey: settings.apiKey,
          baseURL: settings.apiUrl || "https://api.openai.com/v1",
        });

        const { text, toolCalls, steps } = await generateText({
          model: provider(settings.simpleModel || "gpt-4o-mini"),
          messages,
          system: `You are a helpful AI assistant integrated into a web browser automation tool. 
                   You can help users navigate web pages, answer questions about the current page content, 
                   and provide assistance with browser automation tasks.
                   You have access to a calculator tool for evaluating mathematical expressions.
                   When solving math problems, reason step by step and use the calculator when necessary.
                   ${taskId ? `Current task ID: ${taskId}` : ""}`,
          maxSteps: 10,
          tools: {
            calculate: tool({
              description:
                "A tool for evaluating mathematical expressions. " +
                "Example expressions: " +
                "'1.2 * (2 + 4.5)', '12.7 cm to inch', 'sin(45 deg) ^ 2'.",
              parameters: z.object({ expression: z.string() }),
              execute: async ({ expression }) => {
                try {
                  console.log("Calculator tool called with expression:", expression);
                  const result = mathjs.evaluate(expression);
                  console.log("Calculation result:", result);
                  return result;
                } catch (error) {
                  console.error("Calculator error:", error);
                  return `Error evaluating expression: ${error instanceof Error ? error.message : String(error)}`;
                }
              },
            }),
            answer: tool({
              description: "A tool for providing the final answer.",
              parameters: z.object({
                steps: z.array(
                  z.object({
                    calculation: z.string(),
                    reasoning: z.string(),
                  }),
                ),
                answer: z.string(),
              }),
            }),
          },
          toolChoice: toolChoice || undefined,
          onStepFinish({ text, toolCalls, toolResults, finishReason, usage }) {
            console.log("Step finished:", {
              text,
              toolCalls: toolCalls?.map(tc => ({ name: tc.toolName, args: tc.args })),
              toolResults,
              finishReason,
              usage,
            });
          },
        });

        // Extract all tool calls from the steps
        const allToolCalls = steps.flatMap(step => step.toolCalls);

        res.json({
          text,
          toolCalls,
          steps: steps.map(step => ({
            text: step.text,
            toolCalls: step.toolCalls,
            toolResults: step.toolResults,
            finishReason: step.finishReason,
            usage: step.usage,
          })),
          allToolCalls,
        });
      } catch (error) {
        console.error("Chat with steps API error:", error);
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