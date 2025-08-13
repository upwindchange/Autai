import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  streamText,
  tool,
  type UIMessage,
  type ToolChoice,
  type StepResult,
  type Tool,
  type InvalidToolInputError,
  NoSuchToolError,
  convertToModelMessages,
  stepCountIs,
  hasToolCall,
} from "ai";
import * as mathjs from "mathjs";
import { z } from "zod";
import { settingsService } from "..";
import {
  calculateToolSchema,
  answerToolSchema,
  displayErrorToolSchema,
  TOOL_NAMES,
  type CalculateToolResult,
  type DisplayErrorToolResult,
  type CalculateToolParams,
  type DisplayErrorToolParams,
} from "@shared/index";

type AgentTools = {
  [TOOL_NAMES.CALCULATE]: Tool<CalculateToolParams, CalculateToolResult>;
  [TOOL_NAMES.ANSWER]: Tool<z.infer<typeof answerToolSchema>>;
  [TOOL_NAMES.DISPLAY_ERROR]: Tool<
    DisplayErrorToolParams,
    DisplayErrorToolResult
  >;
};

export interface ChatRequest {
  messages: UIMessage[];
  taskId?: string;
  toolChoice?: ToolChoice<AgentTools>;
}

export class AgentHandler {
  private readonly systemPrompt = `You are a helpful AI assistant integrated into a web browser automation tool. 
                         You can help users navigate web pages, answer questions about the current page content, 
                         and provide assistance with browser automation tasks.
                         You have access to a calculator tool for evaluating mathematical expressions.
                         When solving math problems, reason step by step and use the calculator when necessary.`;

  async handleChat(request: ChatRequest): Promise<ReadableStream> {
    const { messages, taskId, toolChoice } = request;
    console.log("[AGENT] Request received:", {
      messagesCount: messages?.length,
      taskId,
      toolChoice,
      messages: JSON.stringify(messages, null, 2),
    });

    // Get settings
    const settings = settingsService.getActiveSettings();
    if (!settings?.apiKey) {
      throw new Error("API key not configured");
    }

    // Create OpenAI-compatible provider
    const provider = createOpenAICompatible({
      name: "openai",
      apiKey: settings.apiKey,
      baseURL: settings.apiUrl || "https://api.openai.com/v1",
    });

    console.log("[AGENT] API Settings:", {
      model: settings.simpleModel || "gpt-4o-mini",
      hasApiKey: !!settings.apiKey,
      baseURL: settings.apiUrl || "default",
      provider: "openai-compatible",
    });

    try {
      console.log(
        "[AGENT] Creating streamText with model:",
        settings.simpleModel || "gpt-4o-mini"
      );

      const result = streamText({
        model: provider(settings.simpleModel || "gpt-4o-mini"),
        messages: convertToModelMessages(messages),
        system: `${this.systemPrompt}${
          taskId ? `\nCurrent task ID: ${taskId}` : ""
        }`,
        stopWhen: [
          // Stop when answer tool is called (task complete)
          hasToolCall(TOOL_NAMES.ANSWER),
          // Stop when error is displayed
          hasToolCall(TOOL_NAMES.DISPLAY_ERROR),
          // Safety limit to prevent infinite loops
          stepCountIs(20),
        ],
        tools: this.getTools(),
        toolChoice: toolChoice || undefined,
        experimental_repairToolCall: this.repairToolCall,
        onStepFinish: this.handleStepFinish,
      });

      console.log("[AGENT] Converting to UI message stream...");
      return result.toUIMessageStream();
    } catch (error) {
      console.error("[AGENT:ERROR] Error in streamText:", error);
      console.error(
        "[AGENT:ERROR] Error stack:",
        error instanceof Error ? error.stack : "No stack"
      );
      console.error(
        "[AGENT:ERROR] Error details:",
        JSON.stringify(error, null, 2)
      );
      throw error;
    }
  }

  private getTools(): AgentTools {
    return {
      [TOOL_NAMES.CALCULATE]: tool({
        description:
          "A tool for evaluating mathematical expressions. " +
          "Example expressions: " +
          "'1.2 * (2 + 4.5)', '12.7 cm to inch', 'sin(45 deg) ^ 2'.",
        inputSchema: calculateToolSchema,
        execute: this.executeCalculate,
      }),
      [TOOL_NAMES.ANSWER]: tool({
        description: "A tool for providing the final answer.",
        inputSchema: answerToolSchema,
        // no execute function - invoking it will terminate the agent
      }),
      [TOOL_NAMES.DISPLAY_ERROR]: tool({
        description:
          "Display an error message to the user when something goes wrong.",
        inputSchema: displayErrorToolSchema,
        execute: this.executeDisplayError,
      }),
    };
  }

  private async executeCalculate({
    expression,
  }: CalculateToolParams): Promise<CalculateToolResult> {
    try {
      console.log("[TOOL:CALCULATE] Called with expression:", expression);
      const result = mathjs.evaluate(expression);
      console.log("[TOOL:CALCULATE] Result:", result);
      return result;
    } catch (error) {
      console.error("[TOOL:CALCULATE] Error:", error);
      return `Error evaluating expression: ${
        error instanceof Error ? error.message : String(error)
      }`;
    }
  }

  private async executeDisplayError({
    title,
    message,
    details,
  }: DisplayErrorToolParams): Promise<DisplayErrorToolResult> {
    console.log("[TOOL:DISPLAY_ERROR] Displaying error:", {
      title,
      message,
      details,
    });
    const result: DisplayErrorToolResult = {
      type: "error",
      title,
      message,
      timestamp: new Date().toISOString(),
      ...(details ? { details } : {}),
    };
    return result;
  }

  private repairToolCall = async ({
    toolCall,
    error,
  }: {
    toolCall: {
      type: "tool-call";
      toolCallId: string;
      toolName: string;
      input: string;
    };
    error: NoSuchToolError | InvalidToolInputError;
  }) => {
    console.log("[AGENT:REPAIR] Attempting to repair tool call:", {
      toolName: toolCall.toolName,
      error: error.message,
      originalArgs: toolCall.input,
    });

    // do not attempt to fix invalid tool names
    if (error instanceof NoSuchToolError) {
      return null;
    }
    // Only repair InvalidToolInputError for the answer tool
    if (!error.message.includes("Invalid input for tool")) {
      return null;
    }

    try {
      // Parse the original arguments
      const parsedArgs = JSON.parse(toolCall.input);

      // Check if steps is a string that needs to be parsed
      if (typeof parsedArgs.steps === "string") {
        console.log(
          "[AGENT:REPAIR] Detected steps as string, attempting to parse..."
        );
        parsedArgs.steps = JSON.parse(parsedArgs.steps);

        // Return the repaired tool call with the correct structure for AI SDK v5
        const repairedCall = {
          type: toolCall.type,
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.toolName,
          input: JSON.stringify(parsedArgs),
        };

        console.log("[AGENT:REPAIR] Successfully repaired tool call:", {
          toolName: repairedCall.toolName,
          repairedArgs: repairedCall.input,
        });

        return repairedCall;
      }
    } catch (repairError) {
      console.error("[AGENT:REPAIR] Failed to repair tool call:", repairError);
    }

    return null;
  };

  private handleStepFinish(stepResult: StepResult<AgentTools>) {
    const { text, toolCalls, toolResults, finishReason, usage } = stepResult;

    // Create a simplified log object without problematic type assertions
    const logData = {
      stepText: text,
      stepTextLength: text?.length,
      toolCallsCount: toolCalls?.length || 0,
      toolCalls: toolCalls?.map((tc) => ({
        name: tc.toolName,
        input: tc.input,
        toolCallId: tc.toolCallId,
      })),
      toolResultsCount: toolResults?.length || 0,
      toolResults: toolResults?.map((tr) => {
        // Safely extract properties from tool results
        const result: {
          toolCallId: string;
          result: unknown;
          toolName?: string;
          input?: unknown;
        } = {
          toolCallId:
            ((tr as Record<string, unknown>).toolCallId as string) || "",
          result: (tr as Record<string, unknown>).result || null,
        };

        // Add optional properties if they exist
        if ("toolName" in (tr as Record<string, unknown>)) {
          result.toolName = (tr as Record<string, unknown>).toolName as string;
        }
        if ("input" in (tr as Record<string, unknown>)) {
          result.input = (tr as Record<string, unknown>).input;
        }

        return result;
      }),
      finishReason,
      usage,
    };

    console.log(
      "[AGENT:STEP] Step finished:",
      JSON.stringify(logData, null, 2)
    );
  }
}

export const agentHandler = new AgentHandler();
