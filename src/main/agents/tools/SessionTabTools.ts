import { tool } from "ai";
import { z } from "zod";
import { SessionTabService } from "@/services";
import type { ToolExecutionContext } from "./types/context";

// ===== Result Types =====

/**
 * Session tool results
 */
export interface SessionDetail {
  sessionId: string;
  tabCount: number;
  activeTabId: string | null;
}

export interface ListSessionsResult {
  totalSessions: number;
  sessions: SessionDetail[];
}

export interface TabDetail {
  tabId: string;
  url: string | null;
  isActive: boolean;
  backendVisibility: boolean;
}

export interface GetSessionTabsResult {
  sessionId: string;
  totalTabs: number;
  activeTabId: string | null;
  tabs: TabDetail[];
}

export interface GetTabInfoResult {
  tabId: string;
  sessionId: string;
  url: string | null;
  isActiveTab: boolean;
  backendVisibility: boolean;
  tabExists: boolean;
}

export interface CreateTabResult {
  success: boolean;
  tabId?: string;
  sessionId?: string;
  url: string;
  message?: string;
  error?: string;
}

export interface GetCurrentSessionContextResult {
  success: boolean;
  sessionId: string;
  activeTabId: string | null;
  totalTabs: number;
  tabs: TabDetail[];
  error?: string;
}

// List all sessions tool
export const listSessionsTool = tool({
  description:
    "Get all available sessions with their tab counts and active tabs",
  inputSchema: z.object({}),
  execute: async () => {
    const sessionTabService = SessionTabService.getInstance();
    const sessionIds = sessionTabService.getAllSessionIds();

    if (sessionIds.length === 0) {
      return {
        totalSessions: 0,
        sessions: [],
      } satisfies ListSessionsResult;
    }

    const sessionDetails = sessionIds.map((sessionId) => {
      const activeTabId =
        sessionTabService.getActiveTabForSession(sessionId);
      const state = sessionTabService.getSessionTabState(sessionId);
      return {
        sessionId,
        tabCount: state?.tabIds.length || 0,
        activeTabId,
      };
    });

    const result: ListSessionsResult = {
      totalSessions: sessionIds.length,
      sessions: sessionDetails,
    };

    return result;
  },
});

// Get session tabs tool
export const getSessionTabsTool = tool({
  description:
    "Get all tabs for the current browser session including their metadata. Uses the current session ID automatically.",
  inputSchema: z.object({}),
  execute: async (_input, { experimental_context }) => {
    const context = experimental_context as ToolExecutionContext;

    if (!context.sessionId) {
      return {
        sessionId: "",
        totalTabs: 0,
        activeTabId: null,
        tabs: [],
      } satisfies GetSessionTabsResult;
    }

    const sessionTabService = SessionTabService.getInstance();
    const tabMetadataList = sessionTabService.getAllTabMetadata(
      context.sessionId,
    );
    const activeTabId = sessionTabService.getActiveTabForSession(
      context.sessionId,
    );

    if (tabMetadataList.length === 0) {
      return {
        sessionId: context.sessionId,
        totalTabs: 0,
        activeTabId,
        tabs: [],
      } satisfies GetSessionTabsResult;
    }

    const tabDetails = tabMetadataList.map((metadata) => {
      const tab = sessionTabService.getTab(metadata.id);
      let currentUrl: string | null = null;
      if (tab?.webContents && !tab.webContents.isDestroyed()) {
        try {
          currentUrl = tab.webContents.getURL();
        } catch (_error) {
          // URL unavailable
        }
      }
      return {
        tabId: metadata.id,
        url: currentUrl,
        isActive: metadata.id === activeTabId,
        backendVisibility: metadata.backendVisibility,
      };
    });

    const result: GetSessionTabsResult = {
      sessionId: context.sessionId,
      totalTabs: tabMetadataList.length,
      activeTabId,
      tabs: tabDetails,
    };

    return result;
  },
});

// Get tab info tool
export const getTabInfoTool = tool({
  description: "Get detailed information about a specific tab",
  inputSchema: z.object({}),
  execute: async (_input, { experimental_context }) => {
    const context = experimental_context as ToolExecutionContext;

    if (!context.activeTabId) {
      throw new Error(
        "No active tab in context. " +
          "Ensure tab selection has run before calling this tool.",
      );
    }

    const sessionTabService = SessionTabService.getInstance();
    const tabMetadata = sessionTabService.getTabMetadata(
      context.activeTabId!,
    );
    const tab = sessionTabService.getTab(context.activeTabId!);

    if (!tabMetadata) {
      throw new Error(`Tab ${context.activeTabId} not found.`);
    }

    const isActiveTab =
      sessionTabService.getActiveTabForSession(tabMetadata.sessionId) ===
      context.activeTabId;

    // Get current URL if tab is available
    let currentUrl: string | null = null;
    if (tab && tab.webContents && !tab.webContents.isDestroyed()) {
      try {
        currentUrl = tab.webContents.getURL();
      } catch (_error) {
        // URL unavailable
      }
    }

    const result: GetTabInfoResult = {
      tabId: context.activeTabId!,
      sessionId: tabMetadata.sessionId,
      url: currentUrl,
      isActiveTab,
      backendVisibility: tabMetadata.backendVisibility,
      tabExists: !!tab && !tab.webContents?.isDestroyed(),
    };

    return result;
  },
});

// Create tab tool
export const createTabTool = tool({
  description:
    "Create a new tab for the current browser session with optional URL. Uses the current session ID automatically.",
  inputSchema: z.object({
    url: z
      .string()
      .optional()
      .describe(
        "The URL to load in the tab (optional, defaults to welcome page)",
      ),
  }),
  execute: async ({ url }, { experimental_context }) => {
    const context = experimental_context as ToolExecutionContext;
    const sessionTabService = SessionTabService.getInstance();

    if (!context.sessionId) {
      const result: CreateTabResult = {
        success: false,
        url: url || "welcome page",
        error:
          "No session ID provided and no current session context available. Please specify a session ID.",
      };
      return result;
    }

    // Check if session exists
    const sessionState = sessionTabService.getSessionTabState(
      context.sessionId,
    );
    if (!sessionState) {
      const result: CreateTabResult = {
        success: false,
        sessionId: context.sessionId,
        url: url || "welcome page",
        error: `Session ${context.sessionId} not found. Please create the session first.`,
      };
      return result;
    }

    try {
      const tabId = await sessionTabService.createTab({
        sessionId: context.sessionId,
        url,
      });
      const result: CreateTabResult = {
        success: true,
        tabId,
        sessionId: context.sessionId,
        url: url || "welcome page",
        message: `Successfully created tab ${tabId} for session ${context.sessionId}`,
      };
      return result;
    } catch (error) {
      const result: CreateTabResult = {
        success: false,
        sessionId: context.sessionId,
        url: url || "welcome page",
        error: error instanceof Error ? error.message : String(error),
      };
      return result;
    }
  },
});

// Get current session context tool
export const getCurrentSessionContextTool = tool({
  description:
    "Get information about the current session context including its tabs. Uses the current session ID automatically.",
  inputSchema: z.object({}),
  execute: async (_input, { experimental_context }) => {
    const context = experimental_context as ToolExecutionContext;

    if (!context.sessionId) {
      const result: GetCurrentSessionContextResult = {
        success: false,
        sessionId: "",
        activeTabId: null,
        totalTabs: 0,
        tabs: [],
        error: "No session ID provided",
      };
      return result;
    }

    const sessionTabService = SessionTabService.getInstance();
    const sessionState = sessionTabService.getSessionTabState(
      context.sessionId,
    );

    if (!sessionState) {
      const result: GetCurrentSessionContextResult = {
        success: false,
        sessionId: context.sessionId,
        activeTabId: null,
        totalTabs: 0,
        tabs: [],
        error: `Session ${context.sessionId} not found in session tab service`,
      };
      return result;
    }

    const activeTabId = sessionTabService.getActiveTabForSession(
      context.sessionId,
    );
    const tabMetadataList = sessionTabService.getAllTabMetadata(
      context.sessionId,
    );

    const result: GetCurrentSessionContextResult = {
      success: true,
      sessionId: context.sessionId,
      activeTabId,
      totalTabs: tabMetadataList.length,
      tabs: tabMetadataList.map((metadata) => {
        const tab = sessionTabService.getTab(metadata.id);
        let currentUrl: string | null = null;
        if (tab?.webContents && !tab.webContents.isDestroyed()) {
          try {
            currentUrl = tab.webContents.getURL();
          } catch (_error) {
            // URL unavailable
          }
        }
        return {
          tabId: metadata.id,
          url: currentUrl,
          isActive: metadata.id === activeTabId,
          backendVisibility: metadata.backendVisibility,
        };
      }),
    };

    return result;
  },
});

// Export all tools as an object for AI SDK
export const sessionTools = {
  listSessions: listSessionsTool,
  getSessionTabs: getSessionTabsTool,
  getTabInfo: getTabInfoTool,
  createTab: createTabTool,
  getCurrentSessionContext: getCurrentSessionContextTool,
};
