/**
 * DOM Analysis Tools for AI Agents
 *
 * Exposes DOM utilities from DOMService and DOMTreeSerializer as AI tools
 * following the established pattern in the codebase
 */

import { tool } from "ai";
import { z } from "zod";
import { SessionTabService } from "@/services";
import { PQueueManager } from "@agents/utils";
import log from "electron-log/main";

const logger = log.scope("DOMTools");

// Input schemas
const getDOMTreeSchema = z.object({
	viewId: z.string().describe("The ID of the view to analyze"),
});

const getFlattenDOMSchema = z.object({
	viewId: z.string().describe("The ID of the view to analyze"),
});

// Tool implementation: Get DOM Tree
export const getDOMTreeTool = tool({
	description:
		"Extract DOM tree with intelligent change detection to identify if the page has changed since last analysis",
	inputSchema: getDOMTreeSchema,
	execute: async ({ viewId }) => {
		return await PQueueManager.getInstance().add(
			async () => {
				const sessionTabService = SessionTabService.getInstance();
				const domService = sessionTabService.getDomService(viewId);

				if (!domService) {
					throw new Error(`DOM service not found for view ${viewId}`);
				}
				const stats = domService.simplifiedDOMState?.stats;
				const changeTime =
					sessionTabService.getTabMetadata(viewId)?.timestamp || 0;
				const detectTime = stats?.timestamp || 0;
				let response = {};
				// Get DOM tree with change detection and update internal state (default)
				if (detectTime > changeTime) {
					response = {
						viewId,
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
							viewId,
							newNodesCount: newState?.stats?.newSimplifiedNodesCount || 0,
							totalNodesCountChange:
								newState?.stats?.simplifiedNodesCountChange || 0,
						};
					} else {
						const { newNodesCount, totalNodesCountChange } =
							await domService.buildSimplifiedDOMTree();
						response = {
							viewId,
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
});

// Tool implementation: Generate LLM Representation
export const getFlattenDOMTool = tool({
	description:
		"Generate an LLM-optimized textual representation of the DOM tree root node",
	inputSchema: getFlattenDOMSchema,
	execute: async ({ viewId }) => {
		return await PQueueManager.getInstance().add(
			async () => {
				const sessionTabService = SessionTabService.getInstance();
				const domService = sessionTabService.getDomService(viewId);

				if (!domService) {
					throw new Error(`DOM service not found for view ${viewId}`);
				}

				// Generate representation using the root node
				const representation =
					domService.simplifiedDOMState?.flattenedDOM ||
					"No DOM tree available";

				const response = {
					viewId,
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
});

// Helper functions

// Export all tools as a ToolSet for AI SDK
export const domTools = {
	get_dom_tree: getDOMTreeTool,
	generate_llm_representation: getFlattenDOMTool,
} as const;

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
