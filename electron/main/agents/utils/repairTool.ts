import { InvalidToolInputError } from "ai";
import { z } from "zod";
import {
  calculateToolSchema,
  answerToolSchema,
  displayErrorToolSchema,
  TOOL_NAMES,
  type ToolName,
  repairZodInput,
} from "@shared/index";

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
  console.log("[CHAT WORKER:REPAIR] Attempting to repair tool call:", {
    toolName: toolCall.toolName,
    error: error.message,
    originalArgs: toolCall.input,
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
      console.log(
        "[CHAT WORKER:REPAIR] Using shared Zod repair utility for tool:",
        toolCall.toolName
      );

      // Use the shared repair utility to fix the entire object structure
      const repairedArgs = repairZodInput(parsedArgs, schema);

      // Return the repaired tool call with the correct structure for AI SDK v5
      const repairedCall = {
        type: toolCall.type,
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        input: JSON.stringify(repairedArgs),
      };

      console.log("[CHAT WORKER:REPAIR] Successfully repaired tool call:", {
        toolName: repairedCall.toolName,
        repairedArgs: repairedCall.input,
      });

      return repairedCall;
    } else {
      console.log(
        "[CHAT WORKER:REPAIR] No schema found for tool:",
        toolCall.toolName
      );

      // Fallback: check if steps is a string that needs to be parsed
      if (typeof parsedArgs.steps === "string") {
        console.log(
          "[CHAT WORKER:REPAIR] Detected steps as string, attempting to parse..."
        );
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

        console.log("[CHAT WORKER:REPAIR] Successfully repaired tool call:", {
          toolName: repairedCall.toolName,
          repairedArgs: repairedCall.input,
        });

        return repairedCall;
      }
    }
  } catch (repairError) {
    console.error(
      "[CHAT WORKER:REPAIR] Failed to repair tool call:",
      repairError
    );
  }

  return null;
}
