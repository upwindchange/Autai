import { tool } from "ai";
import { z } from "zod";
import { SessionTabService } from "@/services";
import { PQueueManager } from "@agents/utils";
import type { ToolExecutionContext } from "./types/context";

// ===== Result Types =====

/**
 * DOM tool results
 */
export interface DOMTreeResult {
	tabId: string;
	newNodesCount: number;
	totalNodesCountChange: number;
	error?: string;
}

export interface FlattenDOMResult {
	tabId: string;
	representation: string;
	error?: string;
}

// Get DOM Tree Tool
export const getDOMTreeTool = tool({
	description:
		"Extract DOM tree with intelligent change detection to identify if the page has changed since last analysis",
	inputSchema: z.object({}),
	execute: async (_input, { experimental_context }) => {
		const context = experimental_context as ToolExecutionContext;

		if (!context.activeTabId) {
			throw new Error(
				"No active tab in context. " +
					"Ensure tab selection has run before calling this tool.",
			);
		}

		return await PQueueManager.getInstance().add(
			async () => {
				const sessionTabService = SessionTabService.getInstance();
				const domService = sessionTabService.getDomService(
					context.activeTabId!,
				);

				if (!domService) {
					const result: DOMTreeResult = {
						tabId: context.activeTabId!,
						newNodesCount: 0,
						totalNodesCountChange: 0,
						error:
							"Error: DOM service not found. Please ensure the browser tab is still active.",
					};
					return result;
				}

				const stats = domService.simplifiedDOMState?.stats;
				const changeTime =
					sessionTabService.getTabMetadata(context.activeTabId!)?.timestamp ||
					0;
				const detectTime = stats?.timestamp || 0;

				let response: DOMTreeResult;

				// Get DOM tree with change detection and update internal state (default)
				if (detectTime > changeTime) {
					response = {
						tabId: context.activeTabId!,
						newNodesCount: stats?.newSimplifiedNodesCount || 0,
						totalNodesCountChange: stats?.simplifiedNodesCountChange || 0,
					};
				} else {
					// Manual rebuild if needed
					const { newNodesCount, totalNodesCountChange } =
						await domService.buildSimplifiedDOMTree();
					response = {
						tabId: context.activeTabId!,
						newNodesCount,
						totalNodesCountChange,
					};
				}

				return response;
			},
			{
				timeout: 45000,
				throwOnTimeout: true,
			},
		);
	},
});

// Get Flatten DOM Tool
export const getFlattenDOMTool = tool({
	description:
		"Generate an LLM-optimized textual representation of the DOM tree root node",
	inputSchema: z.object({}),
	execute: async (_input, { experimental_context }) => {
		const context = experimental_context as ToolExecutionContext;

		if (!context.activeTabId) {
			throw new Error(
				"No active tab in context. " +
					"Ensure tab selection has run before calling this tool.",
			);
		}

		return await PQueueManager.getInstance().add(
			async () => {
				const sessionTabService = SessionTabService.getInstance();
				const domService = sessionTabService.getDomService(
					context.activeTabId!,
				);

				if (!domService) {
					const response: FlattenDOMResult = {
						tabId: context.activeTabId!,
						representation:
							"Error: DOM service not found. Please ensure the browser tab is still active.",
						error: "DOM service not found",
					};
					return response;
				}

				// Generate representation using the root node
				const representation =
					domService.simplifiedDOMState?.flattenedDOM ||
					"No DOM tree available";

				const response: FlattenDOMResult = {
					tabId: context.activeTabId!,
					representation,
				};

				return response;
			},
			{
				timeout: 45000,
				throwOnTimeout: true,
			},
		);
	},
});

// Export all tools as an object for AI SDK
export const domTools = {
	getDOMTree: getDOMTreeTool,
	getFlattenDOM: getFlattenDOMTool,
};
