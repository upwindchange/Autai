import {
  streamText,
  tool,
  type UIMessage,
  type StepResult,
  type Tool,
  convertToModelMessages,
  stepCountIs,
  hasToolCall,
} from "ai";
import * as mathjs from "mathjs";
import { z } from "zod";
import { createAIProvider } from "@agent/provider";
import { repairToolCall } from "@agent/utils";
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
  system?: string;
  tools?: unknown;
}

const systemPrompt = `You are a helpful AI assistant integrated into a web browser automation tool. 
                         You can help users navigate web pages, answer questions about the current page content, 
                         and provide assistance with browser automation tasks.
                         You have access to a calculator tool for evaluating mathematical expressions.
                         When solving math problems, reason step by step and use the calculator when necessary.`;

export class ChatWorker {
  async handleChat(request: ChatRequest): Promise<ReadableStream> {
    const { messages, system, tools } = request;
    console.log("[CHAT WORKER] Request received:", {
      messagesCount: messages?.length,
      system,
      tools,
      messages: JSON.stringify(messages, null, 2),
    });

    try {
      console.log("[CHAT WORKER] Creating streamText with simple model");

      const result = streamText({
        model: createAIProvider("simple"),
        messages: convertToModelMessages(messages),
        system: `${systemPrompt} ${system || ""}`,
        stopWhen: [
          // Stop when answer tool is called (task complete)
          hasToolCall(TOOL_NAMES.ANSWER),
          // Stop when error is displayed
          hasToolCall(TOOL_NAMES.DISPLAY_ERROR),
          // Safety limit to prevent infinite loops
          stepCountIs(20),
        ],
        tools: this.getTools(),
        experimental_repairToolCall: repairToolCall,
        onStepFinish: this.handleStepFinish,
      });

      console.log("[CHAT WORKER] Converting to UI message stream...");
      return result.toUIMessageStream();
    } catch (error) {
      console.error("[CHAT WORKER:ERROR] Error in streamText:", error);
      console.error(
        "[CHAT WORKER:ERROR] Error stack:",
        error instanceof Error ? error.stack : "No stack"
      );
      console.error(
        "[CHAT WORKER:ERROR] Error details:",
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
      "[CHAT WORKER:STEP] Step finished:",
      JSON.stringify(logData, null, 2)
    );
  }
}
