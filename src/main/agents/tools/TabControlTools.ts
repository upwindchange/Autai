import { tool } from "langchain";
import { z } from "zod";
import { TabControlService } from "@/services";
import { PQueueManager } from "@agents/utils";
import { getContextVariable } from "@langchain/core/context";

// Navigate tool
export const navigateTool = tool(
	async ({ url }) => {
		const tabId = getContextVariable("activeTabId");
		if (!tabId) {
			throw new Error(
				"No active tab in context. " +
				"Ensure tab selection has run before calling this tool.",
			);
		}

		return await PQueueManager.getInstance().add(
			async () => {
				const tabControlService = TabControlService.getInstance();
				return await tabControlService.navigateTo(tabId, url);
			},
			{
				timeout: 30000,
				throwOnTimeout: true,
			},
		);
	},
	{
		name: "navigateTool",
		description: "Navigate a browser tab to a specific URL",
		schema: z.object({
			url: z.url().describe("The URL to navigate to (must be a valid URL)"),
		}),
	},
);

// Refresh tool
export const refreshTool = tool(
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
				const tabControlService = TabControlService.getInstance();
				return await tabControlService.refresh(tabId);
			},
			{
				timeout: 30000,
				throwOnTimeout: true,
			},
		);
	},
	{
		name: "refreshTool",
		description: "Refresh the current page in a browser tab",
		schema: z.object({}),
	},
);

// Go back tool
export const goBackTool = tool(
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
				const tabControlService = TabControlService.getInstance();
				return await tabControlService.goBack(tabId);
			},
			{
				timeout: 30000,
				throwOnTimeout: true,
			},
		);
	},
	{
		name: "goBackTool",
		description: "Navigate back in the browser history of a tab",
		schema: z.object({}),
	},
);

// Go forward tool
export const goForwardTool = tool(
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
				const tabControlService = TabControlService.getInstance();
				return await tabControlService.goForward(tabId);
			},
			{
				timeout: 30000,
				throwOnTimeout: true,
			},
		);
	},
	{
		name: "goForwardTool",
		description: "Navigate forward in the browser history of a tab",
		schema: z.object({}),
	},
);

// Export all tools as a ToolSet for AI SDK
export const tabControlTools = [
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
export enum TabControlToolNames {
	NAVIGATE = "navigateTool",
	REFRESH = "refreshTool",
	GO_BACK = "goBackTool",
	GO_FORWARD = "goForwardTool",
}
