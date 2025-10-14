import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { ThreadViewService } from "@/services";
import { PQueueManager } from "@agents/utils";

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

// Create view schema
const createViewSchema = z.object({
  threadId: z.string().describe("The ID of the thread to create the view for"),
  url: z
    .string()
    .optional()
    .describe(
      "The URL to load in the view (optional, defaults to welcome page)"
    ),
});

// Get current thread context schema
const getCurrentThreadContextSchema = z.object({
  threadId: z.string().describe("The ID of the thread to get context for"),
});

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
      const threadViewService = ThreadViewService.getInstance();
      const threadIds = threadViewService.getAllThreadIds();

      if (threadIds.length === 0) {
        return "No threads available.";
      }

      const threadDetails = threadIds.map((threadId) => {
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
    description:
      "Get all available threads with their view counts and active views",
    schema: listThreadsSchema,
  }
);

// Get thread views tool
export const getThreadViewsTool = tool(
  async (input): Promise<string> => {
    const { threadId } = input as z.infer<typeof getThreadViewsSchema>;
    return executeWithQueue(async () => {
      const threadViewService = ThreadViewService.getInstance();
      const viewMetadataList = threadViewService.getAllViewMetadata(threadId);
      const activeViewId = threadViewService.getActiveViewForThread(threadId);

      if (viewMetadataList.length === 0) {
        return `No views found for thread ${threadId}.`;
      }

      const viewDetails = viewMetadataList.map((metadata) => ({
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
      const threadViewService = ThreadViewService.getInstance();
      const viewMetadata = threadViewService.getViewMetadata(viewId);
      const view = threadViewService.getView(viewId);

      if (!viewMetadata) {
        return `View ${viewId} not found.`;
      }

      const isActiveView =
        threadViewService.getActiveViewForThread(viewMetadata.threadId) ===
        viewId;

      // Get current URL if view is available
      let currentUrl = viewMetadata.url;
      if (view && view.webContents && !view.webContents.isDestroyed()) {
        try {
          currentUrl = view.webContents.getURL();
        } catch (_error) {
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

// Create view tool
export const createViewTool = tool(
  async (input): Promise<string> => {
    const { threadId, url } = input as z.infer<typeof createViewSchema>;
    return executeWithQueue(async () => {
      const threadViewService = ThreadViewService.getInstance();

      // ThreadId is now required in the input schema
      const targetThreadId = threadId;

      if (!targetThreadId) {
        const result = {
          success: false,
          error:
            "No thread ID provided and no current thread context available. Please specify a thread ID.",
        };
        return JSON.stringify(result, null, 2);
      }

      // Check if thread exists
      const threadState = threadViewService.getThreadViewState(targetThreadId);
      if (!threadState) {
        const result = {
          success: false,
          threadId: targetThreadId,
          error: `Thread ${targetThreadId} not found. Please create the thread first.`,
        };
        return JSON.stringify(result, null, 2);
      }

      try {
        const viewId = await threadViewService.createView({
          threadId: targetThreadId,
          url,
        });
        const result = {
          success: true,
          viewId,
          threadId: targetThreadId,
          url: url || "welcome page",
          message: `Successfully created view ${viewId} for thread ${targetThreadId}`,
        };
        return JSON.stringify(result, null, 2);
      } catch (error) {
        const result = {
          success: false,
          threadId: targetThreadId,
          url: url || "welcome page",
          error: error instanceof Error ? error.message : String(error),
        };
        return JSON.stringify(result, null, 2);
      }
    }, `Create view for thread ${threadId || "current thread"}`);
  },
  {
    name: "create_view",
    description: "Create a new view for a specific thread with optional URL.",
    schema: createViewSchema,
  }
);

// Get current thread context tool
export const getCurrentThreadContextTool = tool(
  async (input): Promise<string> => {
    return executeWithQueue(async () => {
      const { threadId } = input as z.infer<
        typeof getCurrentThreadContextSchema
      >;
      const threadViewService = ThreadViewService.getInstance();

      if (!threadId) {
        const result = {
          success: false,
          error: "No thread ID provided",
        };
        return JSON.stringify(result, null, 2);
      }

      const threadState = threadViewService.getThreadViewState(threadId);
      if (!threadState) {
        const result = {
          success: false,
          threadId: threadId,
          error: `Thread ${threadId} not found in thread view service`,
        };
        return JSON.stringify(result, null, 2);
      }

      const activeViewId = threadViewService.getActiveViewForThread(threadId);
      const viewMetadataList = threadViewService.getAllViewMetadata(threadId);

      const result = {
        success: true,
        threadId: threadId,
        activeViewId,
        totalViews: viewMetadataList.length,
        views: viewMetadataList.map((metadata) => ({
          viewId: metadata.id,
          url: metadata.url,
          isActive: metadata.id === activeViewId,
          backendVisibility: metadata.backendVisibility,
        })),
      };

      return JSON.stringify(result, null, 2);
    }, "Get current thread context");
  },
  {
    name: "get_current_thread_context",
    description: "Get information about a thread context including its views",
    schema: getCurrentThreadContextSchema,
  }
);

// Export all tools as an array for easy agent integration
export const threadViewTools = [
  listThreadsTool,
  getThreadViewsTool,
  getViewInfoTool,
  createViewTool,
  getCurrentThreadContextTool,
];

// Type definitions for tool results
export type ListThreadsResult = string;
export type GetThreadViewsResult = string;
export type GetViewInfoResult = string;
export type CreateViewResult = string;

// Tool names enum for type safety
export enum ThreadViewToolNames {
  LIST_THREADS = "list_threads",
  GET_THREAD_VIEWS = "get_thread_views",
  GET_VIEW_INFO = "get_view_info",
  CREATE_VIEW = "create_view",
  GET_CURRENT_THREAD_CONTEXT = "get_current_thread_context",
}
