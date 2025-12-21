import { tool } from "langchain";
import { z } from "zod";
import { ViewControlService } from "@/services";
import { PQueueManager } from "@agents/utils";

// Navigate tool
export const navigateTool = tool(
	async ({ viewId, url }) => {
		return await PQueueManager.getInstance().add(
			async () => {
				const viewControlService = ViewControlService.getInstance();
				return await viewControlService.navigateTo(viewId, url);
			},
			{
				timeout: 30000,
				throwOnTimeout: true,
			},
		);
	},
	{
		name: "navigateTool",
		description: "Navigate a browser view to a specific URL",
		schema: z.object({
			viewId: z.string().describe("The ID of the view to navigate"),
			url: z.url().describe("The URL to navigate to (must be a valid URL)"),
		}),
	},
);

// Refresh tool
export const refreshTool = tool(
	async ({ viewId }) => {
		return await PQueueManager.getInstance().add(
			async () => {
				const viewControlService = ViewControlService.getInstance();
				return await viewControlService.refresh(viewId);
			},
			{
				timeout: 30000,
				throwOnTimeout: true,
			},
		);
	},
	{
		name: "refreshTool",
		description: "Refresh the current page in a browser view",
		schema: z.object({
			viewId: z.string().describe("The ID of the view to refresh"),
		}),
	},
);

// Go back tool
export const goBackTool = tool(
	async ({ viewId }) => {
		return await PQueueManager.getInstance().add(
			async () => {
				const viewControlService = ViewControlService.getInstance();
				return await viewControlService.goBack(viewId);
			},
			{
				timeout: 30000,
				throwOnTimeout: true,
			},
		);
	},
	{
		name: "goBackTool",
		description: "Navigate back in the browser history of a view",
		schema: z.object({
			viewId: z.string().describe("The ID of the view to navigate back"),
		}),
	},
);

// Go forward tool
export const goForwardTool = tool(
	async ({ viewId }) => {
		return await PQueueManager.getInstance().add(
			async () => {
				const viewControlService = ViewControlService.getInstance();
				return await viewControlService.goForward(viewId);
			},
			{
				timeout: 30000,
				throwOnTimeout: true,
			},
		);
	},
	{
		name: "goForwardTool",
		description: "Navigate forward in the browser history of a view",
		schema: z.object({
			viewId: z.string().describe("The ID of the view to navigate forward"),
		}),
	},
);

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
