import { InvalidToolInputError } from "ai";
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

    // Check if steps is a string that needs to be parsed
    if (typeof parsedArgs.steps === "string") {
      console.log(
        "[CHAT WORKER:REPAIR] Detected steps as string, attempting to parse..."
      );
      parsedArgs.steps = JSON.parse(parsedArgs.steps);

      // Return the repaired tool call with the correct structure for AI SDK v5
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
  } catch (repairError) {
    console.error(
      "[CHAT WORKER:REPAIR] Failed to repair tool call:",
      repairError
    );
  }

  return null;
}
