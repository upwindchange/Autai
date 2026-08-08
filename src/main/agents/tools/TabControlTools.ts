import { tool } from "ai";
import { z } from "zod";
import { toolContextSchema } from "./types/context";
import { TabControlService } from "@/services";
// ===== Result Types =====

/**
 * Navigation tool results
 */
export type NavigateResult = string;
export type RefreshResult = string;
export type GoBackResult = string;
export type GoForwardResult = string;

// Navigate tool
export const navigateTool = tool({
  description: "Navigate a browser tab to a specific URL",
  inputSchema: z.object({
    url: z
      .string()
      .describe(
        "Required (string): The URL to navigate to (must be a valid URL)",
      ),
  }),
  contextSchema: toolContextSchema,
  execute: async ({ url }, { context }) => {

    if (!context.activeTabId) {
      throw new Error(
        "No active tab in context. " +
          "Ensure tab selection has run before calling this tool.",
      );
    }

    const tabControlService = TabControlService.getInstance();
    return await tabControlService.navigateTo(context.activeTabId!, url);
  },
});

// Refresh tool
export const refreshTool = tool({
  description: "Refresh the current page in a browser tab",
  inputSchema: z.object({}),
  contextSchema: toolContextSchema,
  execute: async (_input, { context }) => {

    if (!context.activeTabId) {
      throw new Error(
        "No active tab in context. " +
          "Ensure tab selection has run before calling this tool.",
      );
    }

    const tabControlService = TabControlService.getInstance();
    return await tabControlService.refresh(context.activeTabId!);
  },
});

// Go back tool
export const goBackTool = tool({
  description: "Navigate back in the browser history of a tab",
  inputSchema: z.object({}),
  contextSchema: toolContextSchema,
  execute: async (_input, { context }) => {

    if (!context.activeTabId) {
      throw new Error(
        "No active tab in context. " +
          "Ensure tab selection has run before calling this tool.",
      );
    }

    const tabControlService = TabControlService.getInstance();
    return await tabControlService.goBack(context.activeTabId!);
  },
});

// Go forward tool
export const goForwardTool = tool({
  description: "Navigate forward in the browser history of a tab",
  inputSchema: z.object({}),
  contextSchema: toolContextSchema,
  execute: async (_input, { context }) => {

    if (!context.activeTabId) {
      throw new Error(
        "No active tab in context. " +
          "Ensure tab selection has run before calling this tool.",
      );
    }

    const tabControlService = TabControlService.getInstance();
    return await tabControlService.goForward(context.activeTabId!);
  },
});

// Export all tools as an object for AI SDK
export const navigationTools = {
  navigate: navigateTool,
  refresh: refreshTool,
  goBack: goBackTool,
  goForward: goForwardTool,
};
