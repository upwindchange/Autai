import { tool } from "ai";
import { z } from "zod";
import { TabControlService } from "@/services";
import { PQueueManager } from "@agents/utils";
import type { ToolExecutionContext } from "./types/context";

// Navigate tool
export const navigateTool = tool({
	description: "Navigate a browser tab to a specific URL",
	inputSchema: z.object({
		url: z
			.string()
			.describe("Required (string): The URL to navigate to (must be a valid URL)"),
	}),
	execute: async ({ url }, { experimental_context }) => {
		const context = experimental_context as ToolExecutionContext;

		if (!context.activeTabId) {
			throw new Error(
				"No active tab in context. " +
					"Ensure tab selection has run before calling this tool.",
			);
		}

		return await PQueueManager.getInstance().add(
			async () => {
				const tabControlService = TabControlService.getInstance();
				return await tabControlService.navigateTo(context.activeTabId!, url);
			},
			{
				timeout: 30000,
				throwOnTimeout: true,
			},
		);
	},
});

// Refresh tool
export const refreshTool = tool({
	description: "Refresh the current page in a browser tab",
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
				const tabControlService = TabControlService.getInstance();
				return await tabControlService.refresh(context.activeTabId!);
			},
			{
				timeout: 30000,
				throwOnTimeout: true,
			},
		);
	},
});

// Go back tool
export const goBackTool = tool({
	description: "Navigate back in the browser history of a tab",
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
				const tabControlService = TabControlService.getInstance();
				return await tabControlService.goBack(context.activeTabId!);
			},
			{
				timeout: 30000,
				throwOnTimeout: true,
			},
		);
	},
});

// Go forward tool
export const goForwardTool = tool({
	description: "Navigate forward in the browser history of a tab",
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
				const tabControlService = TabControlService.getInstance();
				return await tabControlService.goForward(context.activeTabId!);
			},
			{
				timeout: 30000,
				throwOnTimeout: true,
			},
		);
	},
});

// Export all tools as an object for AI SDK
export const navigationTools = {
	navigate: navigateTool,
	refresh: refreshTool,
	goBack: goBackTool,
	goForward: goForwardTool,
};
