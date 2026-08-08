import { z } from "zod";
import type { LanguageModel } from "ai";

/**
 * Context passed to tools via toolsContext
 */
export interface ToolExecutionContext {
  sessionId: string;
  activeTabId?: string;
  /** Per-thread chat model for sub-agents (e.g. askUser). Falls back to global. */
  chatModel?: LanguageModel;
  writer?: unknown;
  abortSignal?: AbortSignal;
}

/**
 * Zod schema for validating context at runtime
 */
export const toolContextSchema = z.object({
  sessionId: z.string().describe("Current browser session ID"),
  activeTabId: z.string().optional().describe("Active tab ID for operations"),
  chatModel: z.custom<LanguageModel>().optional().describe("Per-thread chat model"),
  writer: z.any().optional().describe("Stream writer for forwarding sub-agent output"),
  abortSignal: z.custom<AbortSignal>().optional().describe("Abort signal"),
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
