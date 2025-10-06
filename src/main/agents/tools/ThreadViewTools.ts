import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { ViewControlService } from "@/services";
import { PQueueManager } from "@/agents/queue/PQueueManager";
import { type ThreadId, type ViewId } from "@shared";

// Get all threads schema
const listThreadsSchema = z.object({});

// Get thread views schema
const getThreadViewsSchema = z.object({
  threadId: z.string().describe("The ID of the thread to get views for"),
});

// Get view info schema
const getViewInfoSchema = z.object({
  viewId: z.string().describe("The ID of the view to get information for"),
});

// Get ThreadViewService instance
const getThreadViewService = () => {
  // Access ThreadViewService through ViewControlService singleton
  const viewControlService = ViewControlService.getInstance();
  return viewControlService.getThreadViewService();
};

// Tool execution with p-queue
const executeWithQueue = async <T>(
  task: () => Promise<T>,
  operationName: string
): Promise<T> => {
  try {
    return await PQueueManager.getInstance().add(task, {
      timeout: 10000, // 10 seconds timeout for thread view operations
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

// List all threads tool
export const listThreadsTool = tool(
  async (): Promise<string> => {
    return executeWithQueue(async () => {
      const threadViewService = getThreadViewService();
      const threadIds = threadViewService.getAllThreadIds();

      if (threadIds.length === 0) {
        return "No threads available.";
      }

      const threadDetails = threadIds.map(threadId => {
        const activeViewId = threadViewService.getActiveViewForThread(threadId);
        const state = threadViewService.getThreadViewState(threadId);
        return {
          threadId,
          viewCount: state?.viewIds.length || 0,
          activeViewId,
        };
      });

      const result = {
        totalThreads: threadIds.length,
        threads: threadDetails,
      };

      return JSON.stringify(result, null, 2);
    }, "List all threads");
  },
  {
    name: "list_threads",
    description: "Get all available threads with their view counts and active views",
    schema: listThreadsSchema,
  }
);

// Get thread views tool
export const getThreadViewsTool = tool(
  async (input): Promise<string> => {
    const { threadId } = input as z.infer<typeof getThreadViewsSchema>;
    return executeWithQueue(async () => {
      const threadViewService = getThreadViewService();
      const viewMetadataList = threadViewService.getAllViewMetadata(threadId);
      const activeViewId = threadViewService.getActiveViewForThread(threadId);

      if (viewMetadataList.length === 0) {
        return `No views found for thread ${threadId}.`;
      }

      const viewDetails = viewMetadataList.map(metadata => ({
        viewId: metadata.id,
        url: metadata.url,
        isActive: metadata.id === activeViewId,
        backendVisibility: metadata.backendVisibility,
      }));

      const result = {
        threadId,
        totalViews: viewMetadataList.length,
        activeViewId,
        views: viewDetails,
      };

      return JSON.stringify(result, null, 2);
    }, `Get views for thread ${threadId}`);
  },
  {
    name: "get_thread_views",
    description: "Get all views for a specific thread including their metadata",
    schema: getThreadViewsSchema,
  }
);

// Get view info tool
export const getViewInfoTool = tool(
  async (input): Promise<string> => {
    const { viewId } = input as z.infer<typeof getViewInfoSchema>;
    return executeWithQueue(async () => {
      const threadViewService = getThreadViewService();
      const viewMetadata = threadViewService.getViewMetadata(viewId);
      const view = threadViewService.getView(viewId);

      if (!viewMetadata) {
        return `View ${viewId} not found.`;
      }

      const isActiveView = threadViewService.getActiveViewForThread(viewMetadata.threadId) === viewId;

      // Get current URL if view is available
      let currentUrl = viewMetadata.url;
      if (view && view.webContents && !view.webContents.isDestroyed()) {
        try {
          currentUrl = view.webContents.getURL();
        } catch (error) {
          // Keep original URL if we can't get current URL
        }
      }

      const result = {
        viewId,
        threadId: viewMetadata.threadId,
        url: currentUrl,
        originalUrl: viewMetadata.url,
        isActiveView,
        backendVisibility: viewMetadata.backendVisibility,
        viewExists: !!view && !view.webContents?.isDestroyed(),
      };

      return JSON.stringify(result, null, 2);
    }, `Get info for view ${viewId}`);
  },
  {
    name: "get_view_info",
    description: "Get detailed information about a specific view",
    schema: getViewInfoSchema,
  }
);

// Export all tools as an array for easy agent integration
export const threadViewTools = [
  listThreadsTool,
  getThreadViewsTool,
  getViewInfoTool,
];

// Export tools individually for granular imports
export {
  listThreadsTool as listThreadsTool,
  getThreadViewsTool as getThreadViewsTool,
  getViewInfoTool as getViewInfoTool,
};

// Type definitions for tool results
export type ListThreadsResult = string;
export type GetThreadViewsResult = string;
export type GetViewInfoResult = string;

// Tool names enum for type safety
export enum ThreadViewToolNames {
  LIST_THREADS = "list_threads",
  GET_THREAD_VIEWS = "get_thread_views",
  GET_VIEW_INFO = "get_view_info",
}