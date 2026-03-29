import { InvalidToolInputError, StopCondition } from "ai";
import { z } from "zod";
import {
	calculateToolSchema,
	answerToolSchema,
	displayErrorToolSchema,
	TOOL_NAMES,
	type ToolName,
	repairZodInput,
} from "@shared";
import log from "electron-log/main";

const logger = log.scope("aiSDKTool");

/**
 * Stop condition that checks if a tool was successfully executed
 * (has a tool-result, not just a tool-call or tool-error).
 * This allows the streamText step loop to retry when tool input validation fails.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function hasSuccessfulToolResult(toolName: string): StopCondition<any> {
	return ({ steps }) =>
		steps[steps.length - 1]?.toolResults?.some(
			(r) => r.toolName === toolName,
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
