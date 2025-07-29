import express, { type Express } from "express";
import cors from "cors";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText, generateText, pipeDataStreamToResponse, tool, InvalidToolArgumentsError, NoSuchToolError } from "ai";
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
        console.log("[CHAT] Request received:", {
          messagesCount: messages?.length,
          taskId,
          toolChoice,
          messages: JSON.stringify(messages, null, 2)
        });

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
        
        console.log("[CHAT] API Settings:", {
          model: settings.simpleModel || "gpt-4o-mini",
          hasApiKey: !!settings.apiKey,
          baseURL: settings.apiUrl || "default",
          provider: "openai-compatible"
        });

        // Stream the response using pipeDataStreamToResponse
        console.log("[CHAT] Starting stream response...");
        pipeDataStreamToResponse(res, {
          execute: async (dataStreamWriter) => {
            try {
              console.log("[CHAT] Creating streamText with model:", settings.simpleModel || "gpt-4o-mini");
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
                experimental_repairToolCall: async ({ toolCall, error }) => {
                  console.log("[CHAT:REPAIR] Attempting to repair tool call:", {
                    toolName: toolCall.toolName,
                    error: error.message,
                    originalArgs: toolCall.args
                  });

                  // Only repair InvalidToolArgumentsError for the answer tool
                  if (!InvalidToolArgumentsError.isInstance(error) || toolCall.toolName !== 'answer') {
                    return null;
                  }

                  try {
                    // Parse the original arguments
                    const parsedArgs = JSON.parse(toolCall.args);
                    
                    // Check if steps is a string that needs to be parsed
                    if (typeof parsedArgs.steps === 'string') {
                      console.log("[CHAT:REPAIR] Detected steps as string, attempting to parse...");
                      parsedArgs.steps = JSON.parse(parsedArgs.steps);
                      
                      // Return repaired tool call
                      const repairedCall = {
                        toolCallId: toolCall.toolCallId,
                        toolName: toolCall.toolName,
                        args: JSON.stringify(parsedArgs)
                      };
                      
                      console.log("[CHAT:REPAIR] Successfully repaired tool call:", {
                        toolName: repairedCall.toolName,
                        repairedArgs: parsedArgs
                      });
                      
                      return repairedCall;
                    }
                  } catch (repairError) {
                    console.error("[CHAT:REPAIR] Failed to repair tool call:", repairError);
                  }
                  
                  return null;
                },
                tools: {
                  calculate: tool({
                    description:
                      "A tool for evaluating mathematical expressions. " +
                      "Example expressions: " +
                      "'1.2 * (2 + 4.5)', '12.7 cm to inch', 'sin(45 deg) ^ 2'.",
                    parameters: z.object({ expression: z.string() }),
                    execute: async ({ expression }) => {
                      try {
                        console.log("[TOOL:CALCULATE] Called with expression:", expression);
                        const result = mathjs.evaluate(expression);
                        console.log("[TOOL:CALCULATE] Result:", result);
                        return result;
                      } catch (error) {
                        console.error("[TOOL:CALCULATE] Error:", error);
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
                  console.log("[CHAT:STEP] Step finished:", JSON.stringify({
                    stepText: text,
                    stepTextLength: text?.length,
                    toolCallsCount: toolCalls?.length || 0,
                    toolCalls: toolCalls?.map(tc => ({ 
                      name: tc.toolName, 
                      args: tc.args,
                      toolCallId: tc.toolCallId 
                    })),
                    toolResultsCount: toolResults?.length || 0,
                    toolResults: toolResults?.map(tr => ({
                      toolCallId: tr.toolCallId,
                      toolName: tr.toolName,
                      result: tr.result,
                      args: tr.args
                    })),
                    finishReason,
                    usage,
                  }, null, 2));
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

              console.log("[CHAT] Merging result into data stream...");
              result.mergeIntoDataStream(dataStreamWriter);
              console.log("[CHAT] Stream merge completed");
            } catch (error) {
              console.error("[CHAT:ERROR] Error in streamText:", error);
              console.error("[CHAT:ERROR] Error stack:", error instanceof Error ? error.stack : "No stack");
              console.error("[CHAT:ERROR] Error details:", JSON.stringify(error, null, 2));
              // Write an error message to the data stream
              dataStreamWriter.writeData({
                type: 'error',
                error: error instanceof Error ? error.message : 'An unknown error occurred'
              });
            }
          },
          onError: (error) => {
            console.error("[CHAT:STREAM:ERROR] Stream error:", error);
            console.error("[CHAT:STREAM:ERROR] Error type:", error?.constructor?.name);
            console.error("[CHAT:STREAM:ERROR] Error details:", JSON.stringify(error, null, 2));
            if (error instanceof Error) {
              console.error("[CHAT:STREAM:ERROR] Stack:", error.stack);
            }
            return error instanceof Error ? error.message : String(error);
          },
        });
      } catch (error) {
        console.error("[CHAT:CATCH] Outer error:", error);
        console.error("[CHAT:CATCH] Error stack:", error instanceof Error ? error.stack : "No stack");
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // Chat with steps endpoint - demonstrates accessing all steps
    this.app.post("/chat-with-steps", async (req, res) => {
      try {
        const { messages, taskId, toolChoice } = req.body;
        console.log("[CHAT-STEPS] Request received:", {
          messagesCount: messages?.length,
          taskId,
          toolChoice,
          messages: JSON.stringify(messages, null, 2)
        });

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
        
        console.log("[CHAT-STEPS] Using model:", settings.simpleModel || "gpt-4o-mini");

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
          experimental_repairToolCall: async ({ toolCall, error }) => {
            console.log("[CHAT-STEPS:REPAIR] Attempting to repair tool call:", {
              toolName: toolCall.toolName,
              error: error.message,
              originalArgs: toolCall.args
            });

            // Only repair InvalidToolArgumentsError for the answer tool
            if (!InvalidToolArgumentsError.isInstance(error) || toolCall.toolName !== 'answer') {
              return null;
            }

            try {
              // Parse the original arguments
              const parsedArgs = JSON.parse(toolCall.args);
              
              // Check if steps is a string that needs to be parsed
              if (typeof parsedArgs.steps === 'string') {
                console.log("[CHAT-STEPS:REPAIR] Detected steps as string, attempting to parse...");
                parsedArgs.steps = JSON.parse(parsedArgs.steps);
                
                // Return repaired tool call
                const repairedCall = {
                  toolCallId: toolCall.toolCallId,
                  toolName: toolCall.toolName,
                  args: JSON.stringify(parsedArgs)
                };
                
                console.log("[CHAT-STEPS:REPAIR] Successfully repaired tool call:", {
                  toolName: repairedCall.toolName,
                  repairedArgs: parsedArgs
                });
                
                return repairedCall;
              }
            } catch (repairError) {
              console.error("[CHAT-STEPS:REPAIR] Failed to repair tool call:", repairError);
            }
            
            return null;
          },
          tools: {
            calculate: tool({
              description:
                "A tool for evaluating mathematical expressions. " +
                "Example expressions: " +
                "'1.2 * (2 + 4.5)', '12.7 cm to inch', 'sin(45 deg) ^ 2'.",
              parameters: z.object({ expression: z.string() }),
              execute: async ({ expression }) => {
                try {
                  console.log("[TOOL:CALCULATE:STEPS] Called with expression:", expression);
                  const result = mathjs.evaluate(expression);
                  console.log("[TOOL:CALCULATE:STEPS] Result:", result);
                  return result;
                } catch (error) {
                  console.error("[TOOL:CALCULATE:STEPS] Error:", error);
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
            console.log("[CHAT-STEPS:STEP] Step finished:", JSON.stringify({
              stepText: text,
              stepTextLength: text?.length,
              toolCallsCount: toolCalls?.length || 0,
              toolCalls: toolCalls?.map(tc => ({ 
                name: tc.toolName, 
                args: tc.args,
                toolCallId: tc.toolCallId 
              })),
              toolResultsCount: toolResults?.length || 0,
              toolResults: toolResults?.map(tr => ({
                toolCallId: tr.toolCallId,
                toolName: tr.toolName,
                result: tr.result,
                args: tr.args
              })),
              finishReason,
              usage,
            }, null, 2));
          },
        });

        console.log("[CHAT-STEPS] Generation completed:", JSON.stringify({
          totalSteps: steps?.length,
          finalText: text?.substring(0, 100) + "...",
          totalToolCalls: toolCalls?.length
        }, null, 2));

        // Extract all tool calls from the steps
        const allToolCalls = steps.flatMap(step => step.toolCalls);
        console.log("[CHAT-STEPS] All tool calls extracted:", allToolCalls?.length);

        const response = {
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
        };
        
        console.log("[CHAT-STEPS] Sending response:", {
          responseTextLength: response.text?.length,
          stepsCount: response.steps?.length,
          allToolCallsCount: response.allToolCalls?.length
        });
        
        res.json(response);
      } catch (error) {
        console.error("[CHAT-STEPS:ERROR] Error:", error);
        console.error("[CHAT-STEPS:ERROR] Error stack:", error instanceof Error ? error.stack : "No stack");
        console.error("[CHAT-STEPS:ERROR] Error details:", JSON.stringify(error, null, 2));
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