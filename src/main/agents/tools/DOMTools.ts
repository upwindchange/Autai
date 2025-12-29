/**
 * DOM Analysis Tools for AI Agents
 *
 * Exposes DOM utilities from DOMService and DOMTreeSerializer as AI tools
 * following the established pattern in the codebase
 */

import { tool } from "langchain";
import { z } from "zod";
import { SessionTabService } from "@/services";
import { PQueueManager } from "@agents/utils";
import log from "electron-log/main";

const logger = log.scope("DOMTools");

// Input schemas
const getDOMTreeSchema = z.object({
	tabId: z.string().describe("The ID of the tab to analyze"),
});

const getFlattenDOMSchema = z.object({
	tabId: z.string().describe("The ID of the tab to analyze"),
});

// Tool implementation: Get DOM Tree
export const getDOMTreeTool = tool(
	async ({ tabId }) => {
		return await PQueueManager.getInstance().add(
			async () => {
				const sessionTabService = SessionTabService.getInstance();
				const domService = sessionTabService.getDomService(tabId);

				if (!domService) {
					return JSON.stringify(
						{
							tabId,
							error:
								"Error: DOM service not found. Please ensure the browser tab is still active.",
						},
						null,
						2,
					);
				}
				const stats = domService.simplifiedDOMState?.stats;
				const changeTime =
					sessionTabService.getTabMetadata(tabId)?.timestamp || 0;
				const detectTime = stats?.timestamp || 0;
				let response = {};
				// Get DOM tree with change detection and update internal state (default)
				if (detectTime > changeTime) {
					response = {
						tabId,
						newNodesCount: stats?.newSimplifiedNodesCount || 0,
						totalNodesCountChange: stats?.simplifiedNodesCountChange || 0,
					};
				} else {
					logger.warn("Manually rebuilding DOM Tree");
					setTimeout(() => {}, 5000);
					const newState = domService.simplifiedDOMState;
					if (
						(newState?.stats.timestamp || 0) > detectTime &&
						(newState?.stats.timestamp || 0) > changeTime
					) {
						response = {
							tabId,
							newNodesCount: newState?.stats?.newSimplifiedNodesCount || 0,
							totalNodesCountChange:
								newState?.stats?.simplifiedNodesCountChange || 0,
						};
					} else {
						const { newNodesCount, totalNodesCountChange } =
							await domService.buildSimplifiedDOMTree();
						response = {
							tabId,
							newNodesCount,
							totalNodesCountChange,
						};
					}
				}

				return JSON.stringify(response, null, 2);
			},
			{
				timeout: 45000,
				throwOnTimeout: true,
			},
		);
	},
	{
		name: "getDOMTreeTool",
		description:
			"Extract DOM tree with intelligent change detection to identify if the page has changed since last analysis",
		schema: getDOMTreeSchema,
	},
);

// Tool implementation: Generate LLM Representation
export const getFlattenDOMTool = tool(
	async ({ tabId }) => {
		return await PQueueManager.getInstance().add(
			async () => {
				const sessionTabService = SessionTabService.getInstance();
				const domService = sessionTabService.getDomService(tabId);

				if (!domService) {
					const response = {
						tabId,
						representation:
							"Error: DOM service not found. Please ensure the browser tab is still active.",
					};
					return JSON.stringify(response, null, 2);
				}

				// Generate representation using the root node
				const representation =
					domService.simplifiedDOMState?.flattenedDOM ||
					"No DOM tree available";

				const response = {
					tabId,
					representation,
				};

				return JSON.stringify(response, null, 2);
			},
			{
				timeout: 45000,
				throwOnTimeout: true,
			},
		);
	},
	{
		name: "getFlattenDOMTool",
		description:
			"Generate an LLM-optimized textual representation of the DOM tree root node",
		schema: getFlattenDOMSchema,
	},
);

// Helper functions

// Export all tools as a ToolSet for AI SDK
export const domTools = [getDOMTreeTool, getFlattenDOMTool];

// Type definitions for tool results
export type GetDOMTreeToolResult = string;
export type ResetDOMTreeToolResult = string;
export type getFlattenDOMToolResult = string;
export type GetDOMStatusToolResult = string;

// Tool names enum for type safety
export enum DOMToolNames {
	GET_DOM_TREE = "get_dom_tree",
	RESET_DOM_TREE = "reset_dom_tree",
	GENERATE_LLM_REPRESENTATION = "generate_llm_representation",
	GET_DOM_STATUS = "get_dom_status",
}
