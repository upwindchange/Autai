import { tool } from "langchain";
import { z } from "zod";
import { SessionTabService } from "@/services";
import { PQueueManager } from "@agents/utils";

// Get all sessions schema
const listSessionsSchema = z.object({});

// Get session tabs schema
const getSessionTabsSchema = z.object({
	sessionId: z.string().describe("The ID of the session to get tabs from"),
});

// Get tab info schema
const getTabInfoSchema = z.object({
	tabId: z.string().describe("The ID of the tab to get information for"),
});

// Create tab schema
const createTabSchema = z.object({
	sessionId: z.string().describe("The ID of the session to create the tab for"),
	url: z
		.string()
		.optional()
		.describe(
			"The URL to load in the tab (optional, defaults to welcome page)",
		),
});

// Get current session context schema
const getCurrentSessionContextSchema = z.object({
	sessionId: z.string().describe("The ID of the session to get context for"),
});

// List all sessions tool
export const listSessionsTool = tool(
	async () => {
		return await PQueueManager.getInstance().add(
			async () => {
				const sessionTabService = SessionTabService.getInstance();
				const sessionIds = sessionTabService.getAllSessionIds();

				if (sessionIds.length === 0) {
					return "No sessions available.";
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

				const result = {
					totalSessions: sessionIds.length,
					sessions: sessionDetails,
				};

				return JSON.stringify(result, null, 2);
			},
			{
				timeout: 10000, // 10 seconds timeout for session tab operations
				throwOnTimeout: true,
			},
		);
	},
	{
		name: "listSessionsTool",
		description:
			"Get all available sessions with their tab counts and active tabs",
		schema: listSessionsSchema,
	},
);

// Get session tabs tool
export const getSessionTabsTool = tool(
	async ({ sessionId }) => {
		return await PQueueManager.getInstance().add(
			async () => {
				const sessionTabService = SessionTabService.getInstance();
				const tabMetadataList = sessionTabService.getAllTabMetadata(sessionId);
				const activeTabId = sessionTabService.getActiveTabForSession(sessionId);

				if (tabMetadataList.length === 0) {
					return `No tabs found for session ${sessionId}.`;
				}

				const tabDetails = tabMetadataList.map((metadata) => ({
					tabId: metadata.id,
					url: metadata.url,
					isActive: metadata.id === activeTabId,
					backendVisibility: metadata.backendVisibility,
				}));

				const result = {
					sessionId,
					totalTabs: tabMetadataList.length,
					activeTabId,
					tabs: tabDetails,
				};

				return JSON.stringify(result, null, 2);
			},
			{
				timeout: 10000,
				throwOnTimeout: true,
			},
		);
	},
	{
		name: "getSessionTabsTool",
		description: "Get all tabs for a specific session including their metadata",
		schema: getSessionTabsSchema,
	},
);

// Get tab info tool
export const getTabInfoTool = tool(
	async ({ tabId }) => {
		return await PQueueManager.getInstance().add(
			async () => {
				const sessionTabService = SessionTabService.getInstance();
				const tabMetadata = sessionTabService.getTabMetadata(tabId);
				const tab = sessionTabService.getTab(tabId);

				if (!tabMetadata) {
					return `Tab ${tabId} not found.`;
				}

				const isActiveTab =
					sessionTabService.getActiveTabForSession(tabMetadata.sessionId) ===
					tabId;

				// Get current URL if tab is available
				let currentUrl = tabMetadata.url;
				if (tab && tab.webContents && !tab.webContents.isDestroyed()) {
					try {
						currentUrl = tab.webContents.getURL();
					} catch (_error) {
						// Keep original URL if we can't get current URL
					}
				}

				const result = {
					tabId,
					sessionId: tabMetadata.sessionId,
					url: currentUrl,
					originalUrl: tabMetadata.url,
					isActiveTab,
					backendVisibility: tabMetadata.backendVisibility,
					tabExists: !!tab && !tab.webContents?.isDestroyed(),
				};

				return JSON.stringify(result, null, 2);
			},
			{
				timeout: 10000,
				throwOnTimeout: true,
			},
		);
	},
	{
		name: "getTabInfoTool",
		description: "Get detailed information about a specific tab",
		schema: getTabInfoSchema,
	},
);

// Create tab tool
export const createTabTool = tool(
	async ({ sessionId, url }) => {
		return await PQueueManager.getInstance().add(
			async () => {
				const sessionTabService = SessionTabService.getInstance();
				const targetsessionId = sessionId;

				if (!targetsessionId) {
					const result = {
						success: false,
						error:
							"No session ID provided and no current session context available. Please specify a session ID.",
					};
					return JSON.stringify(result, null, 2);
				}

				// Check if session exists
				const sessionState =
					sessionTabService.getSessionTabState(targetsessionId);
				if (!sessionState) {
					const result = {
						success: false,
						sessionId: targetsessionId,
						error: `Session ${targetsessionId} not found. Please create the session first.`,
					};
					return JSON.stringify(result, null, 2);
				}

				try {
					const tabId = await sessionTabService.createTab({
						sessionId: targetsessionId,
						url,
					});
					const result = {
						success: true,
						tabId,
						sessionId: targetsessionId,
						url: url || "welcome page",
						message: `Successfully created tab ${tabId} for session ${targetsessionId}`,
					};
					return JSON.stringify(result, null, 2);
				} catch (error) {
					const result = {
						success: false,
						sessionId: targetsessionId,
						url: url || "welcome page",
						error: error instanceof Error ? error.message : String(error),
					};
					return JSON.stringify(result, null, 2);
				}
			},
			{
				timeout: 30000, // Longer timeout for tab creation
				throwOnTimeout: true,
			},
		);
	},
	{
		name: "createTabTool",
		description: "Create a new tab for a specific session with optional URL",
		schema: createTabSchema,
	},
);

// Get current session context tool
export const getCurrentSessionContextTool = tool(
	async ({ sessionId }) => {
		return await PQueueManager.getInstance().add(
			async () => {
				const sessionTabService = SessionTabService.getInstance();

				if (!sessionId) {
					const result = {
						success: false,
						error: "No session ID provided",
					};
					return JSON.stringify(result, null, 2);
				}

				const sessionState = sessionTabService.getSessionTabState(sessionId);
				if (!sessionState) {
					const result = {
						success: false,
						sessionId: sessionId,
						error: `Session ${sessionId} not found in session tab service`,
					};
					return JSON.stringify(result, null, 2);
				}

				const activeTabId = sessionTabService.getActiveTabForSession(sessionId);
				const tabMetadataList = sessionTabService.getAllTabMetadata(sessionId);

				const result = {
					success: true,
					sessionId: sessionId,
					activeTabId,
					totalTabs: tabMetadataList.length,
					tabs: tabMetadataList.map((metadata) => ({
						tabId: metadata.id,
						url: metadata.url,
						isActive: metadata.id === activeTabId,
						backendVisibility: metadata.backendVisibility,
					})),
				};

				return JSON.stringify(result, null, 2);
			},
			{
				timeout: 10000,
				throwOnTimeout: true,
			},
		);
	},
	{
		name: "getCurrentSessionContextTool",
		description: "Get information about a session context including its tabs",
		schema: getCurrentSessionContextSchema,
	},
);

// Export all tools as a ToolSet for AI SDK
export const sessionTabTools = {
	list_sessions: listSessionsTool,
	get_session_tabs: getSessionTabsTool,
	get_tab_info: getTabInfoTool,
	create_tab: createTabTool,
	get_current_session_context: getCurrentSessionContextTool,
} as const;

// Type definitions for tool results
export type ListSessionsResult = string;
export type GetSessionTabsResult = string;
export type GetTabInfoResult = string;
export type CreateTabResult = string;

// Tool names enum for type safety
export enum SessionTabToolNames {
	LIST_SESSIONS = "list_sessions",
	GET_SESSION_TABS = "get_session_tabs",
	GET_TAB_INFO = "get_tab_info",
	CREATE_TAB = "create_tab",
	GET_CURRENT_SESSION_CONTEXT = "get_current_session_context",
}
