import { InvalidToolInputError, StopCondition } from "ai";
import { z } from "zod";
import { createIdGenerator } from "@ai-sdk/provider-utils";
import type {
  AssistantModelMessage,
  ToolModelMessage,
  ToolResultOutput,
} from "@ai-sdk/provider-utils";
import {
  calculateToolSchema,
  answerToolSchema,
  displayErrorToolSchema,
  TOOL_NAMES,
  type ToolName,
  repairZodInput,
} from "@shared";
import log from "electron-log/main";

const logger = log.scope("toolUtils");
const generateId = createIdGenerator({ prefix: "call", size: 24 });

// ── Types ──────────────────────────────────────────────────────────────────

export type Tool = {
  execute?: (
    input: unknown,
    options: ToolExecutionOptions,
  ) => Promise<unknown> | unknown;
  [key: string]: unknown;
};

export type ToolExecutionOptions = {
  toolCallId: string;
  messages: unknown[];
  abortSignal?: AbortSignal;
  experimental_context?: unknown;
};

export type ToolExecutionResult = {
  assistantMessage: AssistantModelMessage;
  toolMessage: ToolModelMessage;
  toolCallId: string;
  output: unknown;
};

export type ToolSimulationResult = {
  assistantMessage: AssistantModelMessage;
  toolMessage: ToolModelMessage;
  toolCallId: string;
};

// ── Stream Utilities ───────────────────────────────────────────────────────

/**
 * Manually merges a ReadableStream into a writer and returns a promise that resolves when complete.
 *
 * This is needed because the AI SDK's writer.merge() doesn't expose the completion promise,
 * making it impossible to wait for nested streams to finish before continuing execution.
 *
 * Based on the AI SDK's internal writer.merge() implementation from create-ui-message-stream.ts
 */
export async function mergeStreamAndWait<T>(
  stream: ReadableStream<T>,
  writer: { write: (chunk: T) => void },
): Promise<void> {
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      writer.write(value);
    }
  } finally {
    reader.releaseLock();
  }
}

// ── AI SDK Tool Utilities ──────────────────────────────────────────────────

/**
 * Stop condition that checks if a tool was successfully executed
 * (has a tool-result, not just a tool-call or tool-error).
 * This allows the streamText step loop to retry when tool input validation fails.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function hasSuccessfulToolResult(toolName: string): StopCondition<any> {
  return ({ steps }) =>
    steps[steps.length - 1]?.toolResults?.some(
      (r) => r.toolName === toolName && r.type === "tool-result",
    ) ?? false;
}

function getSchemaForTool(toolName: ToolName): z.ZodSchema<unknown> | null {
  switch (toolName) {
    case TOOL_NAMES.CALCULATE:
      return calculateToolSchema;
    case TOOL_NAMES.ANSWER:
      return answerToolSchema;
    case TOOL_NAMES.DISPLAY_ERROR:
      return displayErrorToolSchema;
    default:
      return null;
  }
}

export async function repairToolCall({
  toolCall,
  error,
}: {
  toolCall: {
    type: "tool-call";
    toolCallId: string;
    toolName: string;
    input: string;
  };
  error: Error | InvalidToolInputError;
}) {
  logger.debug("attempting to repair tool call", {
    toolName: toolCall.toolName,
    error: error.message,
  });

  // do not attempt to fix invalid tool names
  if (!(error instanceof InvalidToolInputError)) {
    return null;
  }

  try {
    // Parse the original arguments
    const parsedArgs = JSON.parse(toolCall.input);

    // Get the schema for this tool
    const schema = getSchemaForTool(toolCall.toolName as ToolName);

    if (schema) {
      logger.debug("using zod repair utility", { toolName: toolCall.toolName });

      // Use the shared repair utility to fix the entire object structure
      const repairedArgs = repairZodInput(parsedArgs, schema);

      // Return the repaired tool call with the correct structure for AI SDK v5
      const repairedCall = {
        type: toolCall.type,
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        input: JSON.stringify(repairedArgs),
      };

      logger.info("tool call repaired", { toolName: repairedCall.toolName });

      return repairedCall;
    } else {
      logger.warn("no schema found for tool", { toolName: toolCall.toolName });

      // Fallback: check if steps is a string that needs to be parsed
      if (typeof parsedArgs.steps === "string") {
        logger.debug("detected steps as string, parsing");
        try {
          parsedArgs.steps = JSON.parse(parsedArgs.steps);
        } catch {
          // If parsing fails, set to empty array
          parsedArgs.steps = [];
        }

        const repairedCall = {
          type: toolCall.type,
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.toolName,
          input: JSON.stringify(parsedArgs),
        };

        logger.info("tool call repaired", { toolName: repairedCall.toolName });

        return repairedCall;
      }
    }
  } catch (repairError) {
    logger.error("failed to repair tool call", repairError);
  }

  return null;
}

// ── Tool Message Utilities ─────────────────────────────────────────────────

/**
 * Executes a tool directly and generates AI SDK native messages.
 */
export async function executeToolDirectly({
  tool,
  toolName,
  input,
}: {
  tool: Tool;
  toolName: string;
  input: unknown;
}): Promise<ToolExecutionResult> {
  const toolCallId = generateId();

  logger.debug("Executing tool directly", {
    toolName,
    toolCallId,
    input,
  });

  let output: unknown;

  try {
    // Execute the tool if it has an execute function
    if (tool.execute) {
      output = await tool.execute(input, {
        toolCallId,
        messages: [],
        abortSignal: undefined,
        experimental_context: undefined,
      });
      logger.debug("Tool executed successfully", {
        toolName,
        toolCallId,
        output,
      });
    } else {
      logger.warn(
        "Tool does not have execute function, returning null output",
        {
          toolName,
          toolCallId,
        },
      );
      output = null;
    }
  } catch (error) {
    logger.error("Tool execution failed", {
      toolName,
      toolCallId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  // Create assistant message with tool call
  const assistantMessage: AssistantModelMessage = {
    role: "assistant",
    content: [
      {
        type: "tool-call",
        toolCallId,
        toolName,
        input,
      },
    ],
  };

  // Create tool message with result
  const toolMessage: ToolModelMessage = {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId,
        toolName,
        output: {
          type: "json",
          value: output,
        } as ToolResultOutput,
      },
    ],
  };

  return {
    assistantMessage,
    toolMessage,
    toolCallId,
    output,
  };
}

/**
 * Simulates a tool call without executing it, using provided output.
 */
export async function simulateToolCall({
  toolName,
  input,
  output,
}: {
  toolName: string;
  input: unknown;
  output: unknown;
}): Promise<ToolSimulationResult> {
  const toolCallId = generateId();

  logger.debug("Simulating tool call", {
    toolName,
    toolCallId,
    input,
    output,
  });

  // Create assistant message with tool call
  const assistantMessage: AssistantModelMessage = {
    role: "assistant",
    content: [
      {
        type: "tool-call",
        toolCallId,
        toolName,
        input,
      },
    ],
  };

  // Create tool message with result
  const toolMessage: ToolModelMessage = {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId,
        toolName,
        output: {
          type: "json",
          value: output,
        } as ToolResultOutput,
      },
    ],
  };

  return {
    assistantMessage,
    toolMessage,
    toolCallId,
  };
}

/**
 * Writes simulated tool call chunks to a UI message stream writer.
 *
 * This is the stream companion to simulateToolCall(). While simulateToolCall
 * creates ModelMessage objects for the LLM context array, this function
 * writes the equivalent UIMessageChunk objects to the SSE writer so the
 * frontend can render the simulated tool call.
 */
export function writeSimulatedToolCallToStream({
  writer,
  toolCallId,
  toolName,
  input,
  output,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  writer: { write: (chunk: any) => void };
  toolCallId: string;
  toolName: string;
  input: unknown;
  output: unknown;
}): void {
  writer.write({
    type: "tool-input-available",
    toolCallId,
    toolName,
    input,
  });
  writer.write({
    type: "tool-output-available",
    toolCallId,
    output,
  });
}
