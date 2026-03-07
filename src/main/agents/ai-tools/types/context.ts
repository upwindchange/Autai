import { z } from "zod";

/**
 * Context passed to tools via experimental_context
 * Provides tabId and sessionId without consuming tokens
 */
export interface ToolExecutionContext {
	sessionId: string;
	activeTabId?: string;
}

/**
 * Zod schema for validating context at runtime
 */
export const toolContextSchema = z.object({
	sessionId: z.string().describe("Current browser session ID"),
	activeTabId: z.string().optional().describe("Active tab ID for operations"),
});

/**
 * Context options for agent initialization
 */
export interface ToolContextOptions {
	sessionId: string;
	activeTabId?: string;
}

/**
 * Type guard to check if context is valid
 */
export function isValidToolContext(
	context: unknown,
): context is ToolExecutionContext {
	return toolContextSchema.safeParse(context).success;
}
