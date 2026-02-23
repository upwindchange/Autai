import { tool } from "langchain";
import { z } from "zod";
import { SessionTabService } from "@/services";
import { PQueueManager } from "@agents/utils";
import { getContextVariable } from "@langchain/core/context";

// Type definitions for tool results
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

export interface CreateTabResultSuccess {
	success: true;
	tabId: string;
	sessionId: string;
	url: string;
	message: string;
}

export interface CreateTabResultFailure {
	success: false;
	sessionId?: string;
	url: string;
	error: string;
}

export type CreateTabResult = CreateTabResultSuccess | CreateTabResultFailure;

export interface GetCurrentSessionContextResult {
	success: boolean;
	sessionId: string;
	activeTabId: string | null;
	totalTabs: number;
	tabs: TabDetail[];
	error?: string;
}

// Get all sessions schema
const listSessionsSchema = z.object({});

// Get session tabs schema
const getSessionTabsSchema = z.object({});

// Get tab info schema
const getTabInfoSchema = z.object({});

// Create tab schema
const createTabSchema = z.object({
	url: z
		.string()
		.optional()
		.describe(
			"The URL to load in the tab (optional, defaults to welcome page)",
		),
});

// Get current session context schema
const getCurrentSessionContextSchema = z.object({});

// List all sessions tool
export const listSessionsTool = tool(
	async () => {
		return await PQueueManager.getInstance().add(
			async () => {
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
	async (_input) => {
		return await PQueueManager.getInstance().add(
			async () => {
				// Get sessionId from context variable
				const sessionId = getContextVariable("sessionId");

				if (!sessionId) {
					return {
						sessionId: "",
						totalTabs: 0,
						activeTabId: null,
						tabs: [],
					} satisfies GetSessionTabsResult;
				}

				const sessionTabService = SessionTabService.getInstance();
				const tabMetadataList = sessionTabService.getAllTabMetadata(sessionId);
				const activeTabId = sessionTabService.getActiveTabForSession(sessionId);

				if (tabMetadataList.length === 0) {
					return {
						sessionId,
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
					sessionId,
					totalTabs: tabMetadataList.length,
					activeTabId,
					tabs: tabDetails,
				};

				return result;
			},
			{
				timeout: 10000,
				throwOnTimeout: true,
			},
		);
	},
	{
		name: "getSessionTabsTool",
		description:
			"Get all tabs for the current browser session including their metadata. Uses the current session ID automatically.",
		schema: getSessionTabsSchema,
	},
);

// Get tab info tool
export const getTabInfoTool = tool(
	async () => {
		const tabId = getContextVariable("activeTabId");
		if (!tabId) {
			throw new Error(
				"No active tab in context. " +
				"Ensure tab selection has run before calling this tool.",
			);
		}

		return await PQueueManager.getInstance().add(
			async () => {
				const sessionTabService = SessionTabService.getInstance();
				const tabMetadata = sessionTabService.getTabMetadata(tabId);
				const tab = sessionTabService.getTab(tabId);

				if (!tabMetadata) {
					throw new Error(`Tab ${tabId} not found.`);
				}

				const isActiveTab =
					sessionTabService.getActiveTabForSession(tabMetadata.sessionId) ===
					tabId;

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
					tabId: tabId,
					sessionId: tabMetadata.sessionId,
					url: currentUrl,
					isActiveTab,
					backendVisibility: tabMetadata.backendVisibility,
					tabExists: !!tab && !tab.webContents?.isDestroyed(),
				};

				return result;
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
	async ({ url }) => {
		return await PQueueManager.getInstance().add(
			async () => {
				// Get sessionId from context variable
				const sessionId = getContextVariable("sessionId");
				const sessionTabService = SessionTabService.getInstance();

				if (!sessionId) {
					const result: CreateTabResultFailure = {
						success: false,
						url: url || "welcome page",
						error:
							"No session ID provided and no current session context available. Please specify a session ID.",
					};
					return result;
				}

				// Check if session exists
				const sessionState = sessionTabService.getSessionTabState(sessionId);
				if (!sessionState) {
					const result: CreateTabResultFailure = {
						success: false,
						sessionId: sessionId,
						url: url || "welcome page",
						error: `Session ${sessionId} not found. Please create the session first.`,
					};
					return result;
				}

				try {
					const tabId = await sessionTabService.createTab({
						sessionId: sessionId,
						url,
					});
					const result: CreateTabResultSuccess = {
						success: true,
						tabId,
						sessionId: sessionId,
						url: url || "welcome page",
						message: `Successfully created tab ${tabId} for session ${sessionId}`,
					};
					return result;
				} catch (error) {
					const result: CreateTabResultFailure = {
						success: false,
						sessionId: sessionId,
						url: url || "welcome page",
						error: error instanceof Error ? error.message : String(error),
					};
					return result;
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
		description:
			"Create a new tab for the current browser session with optional URL. Uses the current session ID automatically.",
		schema: createTabSchema,
	},
);

// Get current session context tool
export const getCurrentSessionContextTool = tool(
	async (_input) => {
		return await PQueueManager.getInstance().add(
			async () => {
				// Get sessionId from context variable
				const sessionId = getContextVariable("sessionId");
				const sessionTabService = SessionTabService.getInstance();

				if (!sessionId) {
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

				const sessionState = sessionTabService.getSessionTabState(sessionId);
				if (!sessionState) {
					const result: GetCurrentSessionContextResult = {
						success: false,
						sessionId: sessionId,
						activeTabId: null,
						totalTabs: 0,
						tabs: [],
						error: `Session ${sessionId} not found in session tab service`,
					};
					return result;
				}

				const activeTabId = sessionTabService.getActiveTabForSession(sessionId);
				const tabMetadataList = sessionTabService.getAllTabMetadata(sessionId);

				const result: GetCurrentSessionContextResult = {
					success: true,
					sessionId: sessionId,
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
			{
				timeout: 10000,
				throwOnTimeout: true,
			},
		);
	},
	{
		name: "getCurrentSessionContextTool",
		description:
			"Get information about the current session context including its tabs. Uses the current session ID automatically.",
		schema: getCurrentSessionContextSchema,
	},
);

// Export all tools as a ToolSet for AI SDK
export const sessionTabTools = [
	listSessionsTool,
	getSessionTabsTool,
	getTabInfoTool,
	createTabTool,
	getCurrentSessionContextTool,
];

// Tool names enum for type safety
export enum SessionTabToolNames {
	LIST_SESSIONS = "list_sessions",
	GET_SESSION_TABS = "get_session_tabs",
	GET_TAB_INFO = "get_tab_info",
	CREATE_TAB = "create_tab",
	GET_CURRENT_SESSION_CONTEXT = "get_current_session_context",
}
