import { tool } from "ai";
import { z } from "zod";
import { ViewControlService } from "@/services";
import { PQueueManager } from "@agents/utils";

// Navigate tool
export const navigateTool = tool({
  description: "Navigate a browser view to a specific URL",
  inputSchema: z.object({
    viewId: z.string().describe("The ID of the view to navigate"),
    url: z.url().describe("The URL to navigate to (must be a valid URL)"),
  }),
  execute: async ({ viewId, url }) => {
    return await PQueueManager.getInstance().add(async () => {
      const viewControlService = ViewControlService.getInstance();
      return await viewControlService.navigateTo(viewId, url);
    }, {
      timeout: 30000,
      throwOnTimeout: true,
    });
  },
});

// Refresh tool
export const refreshTool = tool({
  description: "Refresh the current page in a browser view",
  inputSchema: z.object({
    viewId: z.string().describe("The ID of the view to refresh"),
  }),
  execute: async ({ viewId }) => {
    return await PQueueManager.getInstance().add(async () => {
      const viewControlService = ViewControlService.getInstance();
      return await viewControlService.refresh(viewId);
    }, {
      timeout: 30000,
      throwOnTimeout: true,
    });
  },
});

// Go back tool
export const goBackTool = tool({
  description: "Navigate back in the browser history of a view",
  inputSchema: z.object({
    viewId: z.string().describe("The ID of the view to navigate back"),
  }),
  execute: async ({ viewId }) => {
    return await PQueueManager.getInstance().add(async () => {
      const viewControlService = ViewControlService.getInstance();
      return await viewControlService.goBack(viewId);
    }, {
      timeout: 30000,
      throwOnTimeout: true,
    });
  },
});

// Go forward tool
export const goForwardTool = tool({
  description: "Navigate forward in the browser history of a view",
  inputSchema: z.object({
    viewId: z.string().describe("The ID of the view to navigate forward"),
  }),
  execute: async ({ viewId }) => {
    return await PQueueManager.getInstance().add(async () => {
      const viewControlService = ViewControlService.getInstance();
      return await viewControlService.goForward(viewId);
    }, {
      timeout: 30000,
      throwOnTimeout: true,
    });
  },
});

// Export all tools as a ToolSet for AI SDK
export const viewControlTools = [
  navigateTool,
  refreshTool,
  goBackTool,
  goForwardTool,
] as const;

// Type definitions for tool results
export type NavigateToolResult = string;
export type RefreshToolResult = string;
export type GoBackToolResult = string;
export type GoForwardToolResult = string;

// Tool names enum for type safety
export enum ViewControlToolNames {
  NAVIGATE = "navigateTool",
  REFRESH = "refreshTool",
  GO_BACK = "goBackTool",
  GO_FORWARD = "goForwardTool",
}
