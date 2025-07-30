import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  streamText,
  tool,
  InvalidToolArgumentsError,
  type DataStreamWriter,
  type CoreMessage,
  type ToolChoice,
  type StepResult,
  type ToolCallRepairFunction,
  type Tool,
} from "ai";
import * as mathjs from "mathjs";
import { settingsService } from "../SettingsService";
import {
  calculateToolSchema,
  answerToolSchema,
  displayErrorToolSchema,
  TOOL_NAMES,
  type CalculateToolResult,
  type DisplayErrorToolResult,
  type CalculateToolParams,
  type DisplayErrorToolParams,
} from "@shared/tools";

type AgentTools = {
  [TOOL_NAMES.CALCULATE]: Tool<typeof calculateToolSchema, CalculateToolResult>;
  [TOOL_NAMES.ANSWER]: Tool<typeof answerToolSchema, void>;
  [TOOL_NAMES.DISPLAY_ERROR]: Tool<
    typeof displayErrorToolSchema,
    DisplayErrorToolResult
  >;
};

export interface ChatRequest {
  messages: CoreMessage[];
  taskId?: string;
  toolChoice?: ToolChoice<AgentTools>;
}

export class AgentHandler {
  private readonly systemPrompt = `You are a helpful AI assistant integrated into a web browser automation tool. 
                         You can help users navigate web pages, answer questions about the current page content, 
                         and provide assistance with browser automation tasks.
                         You have access to a calculator tool for evaluating mathematical expressions.
                         When solving math problems, reason step by step and use the calculator when necessary.
                         
                         IMPORTANT: If you encounter any errors or issues during processing, immediately use the displayError tool to inform the user.
                         This includes calculation errors, processing errors, or if you're unable to complete a task.
                         Always provide clear error messages to help the user understand what went wrong.`;

  async handleChat(
    request: ChatRequest,
    dataStreamWriter: DataStreamWriter
  ): Promise<void> {
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
        messages,
        system: `${this.systemPrompt}${
          taskId ? `\nCurrent task ID: ${taskId}` : ""
        }`,
        maxSteps: 10,
        experimental_repairToolCall: this.repairToolCall,
        tools: this.getTools(),
        toolChoice: toolChoice || undefined,
        onStepFinish: this.handleStepFinish,
      });

      console.log("[AGENT] Merging result into data stream...");
      result.mergeIntoDataStream(dataStreamWriter);
      console.log("[AGENT] Stream merge completed");
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
      // Write an error message to the data stream
      dataStreamWriter.writeData({
        type: "error",
        error:
          error instanceof Error ? error.message : "An unknown error occurred",
      });
    }
  }

  private getTools(): AgentTools {
    return {
      [TOOL_NAMES.CALCULATE]: tool({
        description:
          "A tool for evaluating mathematical expressions. " +
          "Example expressions: " +
          "'1.2 * (2 + 4.5)', '12.7 cm to inch', 'sin(45 deg) ^ 2'.",
        parameters: calculateToolSchema,
        execute: this.executeCalculate,
      }),
      [TOOL_NAMES.ANSWER]: tool({
        description: "A tool for providing the final answer.",
        parameters: answerToolSchema,
        // no execute function - invoking it will terminate the agent
      }),
      [TOOL_NAMES.DISPLAY_ERROR]: tool({
        description:
          "Display an error message to the user when something goes wrong.",
        parameters: displayErrorToolSchema,
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

  private repairToolCall: ToolCallRepairFunction<AgentTools> = async ({
    toolCall,
    error,
  }) => {
    console.log("[AGENT:REPAIR] Attempting to repair tool call:", {
      toolName: toolCall.toolName,
      error: error.message,
      originalArgs: toolCall.args,
    });

    // Only repair InvalidToolArgumentsError for the answer tool
    if (
      !InvalidToolArgumentsError.isInstance(error) ||
      toolCall.toolName !== "answer"
    ) {
      return null;
    }

    try {
      // Parse the original arguments
      const parsedArgs = JSON.parse(toolCall.args);

      // Check if steps is a string that needs to be parsed
      if (typeof parsedArgs.steps === "string") {
        console.log(
          "[AGENT:REPAIR] Detected steps as string, attempting to parse..."
        );
        parsedArgs.steps = JSON.parse(parsedArgs.steps);

        // Return repaired tool call
        const repairedCall = {
          toolCallType: "function" as const,
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.toolName,
          args: JSON.stringify(parsedArgs),
        };

        console.log("[AGENT:REPAIR] Successfully repaired tool call:", {
          toolName: repairedCall.toolName,
          repairedArgs: repairedCall.args,
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
        args: tc.args,
        toolCallId: tc.toolCallId,
      })),
      toolResultsCount: toolResults?.length || 0,
      toolResults: toolResults?.map((tr) => {
        // Safely extract properties from tool results
        const result: {
          toolCallId: string;
          result: unknown;
          toolName?: string;
          args?: unknown;
        } = {
          toolCallId: (tr as Record<string, unknown>).toolCallId as string || '',
          result: (tr as Record<string, unknown>).result || null,
        };
        
        // Add optional properties if they exist
        if ('toolName' in (tr as Record<string, unknown>)) {
          result.toolName = (tr as Record<string, unknown>).toolName as string;
        }
        if ('args' in (tr as Record<string, unknown>)) {
          result.args = (tr as Record<string, unknown>).args;
        }
        
        return result;
      }),
      finishReason,
      usage,
    };
    
    console.log(
      "[AGENT:STEP] Step finished:",
      JSON.stringify(logData,
        null,
        2
      )
    );
  }
}

export const agentHandler = new AgentHandler();
