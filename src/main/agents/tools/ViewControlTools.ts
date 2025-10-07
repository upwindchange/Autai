import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { ViewControlService } from "@/services";
import { PQueueManager } from "@/agents/queue/PQueueManager";

// NavigateTool schema
const navigateSchema = z.object({
  viewId: z.string().describe("The ID of the view to navigate"),
  url: z.url().describe("The URL to navigate to (must be a valid URL)"),
});

// RefreshTool schema
const refreshSchema = z.object({
  viewId: z.string().describe("The ID of the view to refresh"),
});

// GoBackTool schema
const goBackSchema = z.object({
  viewId: z.string().describe("The ID of the view to navigate back"),
});

// GoForwardTool schema
const goForwardSchema = z.object({
  viewId: z.string().describe("The ID of the view to navigate forward"),
});

// Tool execution with p-queue
const executeWithQueue = async <T>(
  task: () => Promise<T>,
  operationName: string
): Promise<T> => {
  try {
    return await PQueueManager.getInstance().add(task, {
      timeout: 30000, // 30 seconds timeout for view operations
      throwOnTimeout: true,
    });
  } catch (error) {
    throw new Error(
      `${operationName} failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
};

// Navigate tool
export const navigateTool = tool(
  async (input): Promise<string> => {
    const { viewId, url } = input as z.infer<typeof navigateSchema>;
    return executeWithQueue(async () => {
      const viewControlService = ViewControlService.getInstance();
      return await viewControlService.navigateTo(viewId, url);
    }, `Navigate view ${viewId} to ${url}`);
  },
  {
    name: "navigate_view",
    description: "Navigate a browser view to a specific URL",
    schema: navigateSchema,
  }
);

// Refresh tool
export const refreshTool = tool(
  async (input): Promise<string> => {
    const { viewId } = input as z.infer<typeof refreshSchema>;
    return executeWithQueue(async () => {
      const viewControlService = ViewControlService.getInstance();
      return await viewControlService.refresh(viewId);
    }, `Refresh view ${viewId}`);
  },
  {
    name: "refresh_view",
    description: "Refresh the current page in a browser view",
    schema: refreshSchema,
  }
);

// Go back tool
export const goBackTool = tool(
  async (input): Promise<string> => {
    const { viewId } = input as z.infer<typeof goBackSchema>;
    return executeWithQueue(async () => {
      const viewControlService = ViewControlService.getInstance();
      return await viewControlService.goBack(viewId);
    }, `Go back in view ${viewId}`);
  },
  {
    name: "go_back_view",
    description: "Navigate back in the browser history of a view",
    schema: goBackSchema,
  }
);

// Go forward tool
export const goForwardTool = tool(
  async (input): Promise<string> => {
    const { viewId } = input as z.infer<typeof goForwardSchema>;
    return executeWithQueue(async () => {
      const viewControlService = ViewControlService.getInstance();
      return await viewControlService.goForward(viewId);
    }, `Go forward in view ${viewId}`);
  },
  {
    name: "go_forward_view",
    description: "Navigate forward in the browser history of a view",
    schema: goForwardSchema,
  }
);

// Export all tools as an array for easy agent integration
export const viewControlTools = [
  navigateTool,
  refreshTool,
  goBackTool,
  goForwardTool,
];

// Type definitions for tool results
export type NavigateToolResult = string;
export type RefreshToolResult = string;
export type GoBackToolResult = string;
export type GoForwardToolResult = string;

// Tool names enum for type safety
export enum ViewControlToolNames {
  NAVIGATE = "navigate_view",
  REFRESH = "refresh_view",
  GO_BACK = "go_back_view",
  GO_FORWARD = "go_forward_view",
}
