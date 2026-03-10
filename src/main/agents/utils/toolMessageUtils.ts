import { createIdGenerator } from '@ai-sdk/provider-utils';
import type {
	AssistantModelMessage,
	ToolModelMessage,
	ToolResultOutput,
} from '@ai-sdk/provider-utils';
import log from 'electron-log/main';

const logger = log.scope('ToolMessageUtils');

const generateId = createIdGenerator({ prefix: 'call', size: 24 });

/**
 * Tool interface that matches the AI SDK tool structure
 */
export type Tool = {
	execute?: (input: unknown, options: ToolExecutionOptions) => Promise<unknown> | unknown;
	[key: string]: unknown;
};

/**
 * Options passed to tool execute function
 */
export type ToolExecutionOptions = {
	toolCallId: string;
	messages: unknown[];
	abortSignal?: AbortSignal;
	experimental_context?: unknown;
};

/**
 * Result from executeToolDirectly function
 */
export type ToolExecutionResult = {
	assistantMessage: AssistantModelMessage;
	toolMessage: ToolModelMessage;
	toolCallId: string;
	output: unknown;
};

/**
 * Executes a tool directly and generates AI SDK native messages.
 *
 * This function:
 * 1. Generates a unique tool call ID
 * 2. Executes the tool with the provided input
 * 3. Creates an AssistantModelMessage with the tool call
 * 4. Creates a ToolModelMessage with the tool result
 *
 * @param params - The parameters for tool execution
 * @param params.tool - The tool object to execute (must have execute function)
 * @param params.toolName - The name of the tool
 * @param params.input - The input parameters for the tool
 *
 * @returns Object containing assistant message, tool message, tool call ID, and output
 *
 * @example
 * ```typescript
 * const weatherTool = tool({
 *   description: 'Get weather for a location',
 *   inputSchema: z.object({ location: z.string() }),
 *   execute: async ({ location }) => {
 *     return { temperature: 72, condition: 'sunny' };
 *   },
 * });
 *
 * const { assistantMessage, toolMessage, toolCallId, output } =
 *   await executeToolDirectly({
 *     tool: weatherTool,
 *     toolName: 'weatherTool',
 *     input: { location: 'San Francisco' },
 *   });
 * ```
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

	logger.debug('Executing tool directly', {
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
			logger.debug('Tool executed successfully', {
				toolName,
				toolCallId,
				output,
			});
		} else {
			logger.warn('Tool does not have execute function, returning null output', {
				toolName,
				toolCallId,
			});
			output = null;
		}
	} catch (error) {
		logger.error('Tool execution failed', {
			toolName,
			toolCallId,
			error: error instanceof Error ? error.message : String(error),
		});
		throw error;
	}

	// Create assistant message with tool call
	const assistantMessage: AssistantModelMessage = {
		role: 'assistant',
		content: [
			{
				type: 'tool-call',
				toolCallId,
				toolName,
				input,
			},
		],
	};

	// Create tool message with result
	const toolMessage: ToolModelMessage = {
		role: 'tool',
		content: [
			{
				type: 'tool-result',
				toolCallId,
				toolName,
				output: {
					type: 'json',
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
 * Result from simulateToolCall function
 */
export type ToolSimulationResult = {
	assistantMessage: AssistantModelMessage;
	toolMessage: ToolModelMessage;
	toolCallId: string;
};

/**
 * Simulates a tool call without executing it, using provided output.
 *
 * This function:
 * 1. Generates a unique tool call ID
 * 2. Creates an AssistantModelMessage with the tool call
 * 3. Creates a ToolModelMessage with the provided output
 *
 * Useful for:
 * - Testing tool interactions without actual execution
 * - Injecting mock tool results into conversation history
 * - Simulating tool calls for debugging purposes
 *
 * @param params - The parameters for tool simulation
 * @param params.toolName - The name of the tool
 * @param params.input - The input parameters for the tool
 * @param params.output - The output to use (tool is NOT executed)
 *
 * @returns Object containing assistant message, tool message, and tool call ID
 *
 * @example
 * ```typescript
 * const { assistantMessage, toolMessage, toolCallId } =
 *   await simulateToolCall({
 *     toolName: 'weatherTool',
 *     input: { location: 'San Francisco' },
 *     output: { temperature: 72, condition: 'sunny' },
 *   });
 * ```
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

	logger.debug('Simulating tool call', {
		toolName,
		toolCallId,
		input,
		output,
	});

	// Create assistant message with tool call
	const assistantMessage: AssistantModelMessage = {
		role: 'assistant',
		content: [
			{
				type: 'tool-call',
				toolCallId,
				toolName,
				input,
			},
		],
	};

	// Create tool message with result
	const toolMessage: ToolModelMessage = {
		role: 'tool',
		content: [
			{
				type: 'tool-result',
				toolCallId,
				toolName,
				output: {
					type: 'json',
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
