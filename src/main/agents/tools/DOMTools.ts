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
import { getContextVariable } from "@langchain/core/context";
import log from "electron-log/main";

const logger = log.scope("DOMTools");

// Type definitions for tool results
export interface GetDOMTreeToolResultSuccess {
	tabId: string;
	newNodesCount: number;
	totalNodesCountChange: number;
}

export interface GetDOMTreeToolResultError {
	tabId: string;
	error: string;
}

export type GetDOMTreeToolResult =
	| GetDOMTreeToolResultSuccess
	| GetDOMTreeToolResultError;

export interface GetFlattenDOMToolResultSuccess {
	tabId: string;
	representation: string;
}

export interface GetFlattenDOMToolResultError {
	tabId: string;
	representation: string;
}

export type GetFlattenDOMToolResult =
	| GetFlattenDOMToolResultSuccess
	| GetFlattenDOMToolResultError;

// Input schemas
const getDOMTreeSchema = z.object({});

const getFlattenDOMSchema = z.object({});

// Tool implementation: Get DOM Tree
export const getDOMTreeTool = tool(
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
				const domService = sessionTabService.getDomService(tabId);

				if (!domService) {
					const result: GetDOMTreeToolResultError = {
						tabId: tabId,
						error:
							"Error: DOM service not found. Please ensure the browser tab is still active.",
					};
					return result;
				}
				const stats = domService.simplifiedDOMState?.stats;
				const changeTime =
					sessionTabService.getTabMetadata(tabId)?.timestamp || 0;
				const detectTime = stats?.timestamp || 0;
				let response: GetDOMTreeToolResultSuccess;
				// Get DOM tree with change detection and update internal state (default)
				if (detectTime > changeTime) {
					response = {
						tabId: tabId,
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
							tabId: tabId,
							newNodesCount: newState?.stats?.newSimplifiedNodesCount || 0,
							totalNodesCountChange:
								newState?.stats?.simplifiedNodesCountChange || 0,
						};
					} else {
						const { newNodesCount, totalNodesCountChange } =
							await domService.buildSimplifiedDOMTree();
						response = {
							tabId: tabId,
							newNodesCount,
							totalNodesCountChange,
						};
					}
				}

				return response;
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
				const domService = sessionTabService.getDomService(tabId);

				if (!domService) {
					const response: GetFlattenDOMToolResultError = {
						tabId: tabId,
						representation:
							"Error: DOM service not found. Please ensure the browser tab is still active.",
					};
					return response;
				}

				// Generate representation using the root node
				const representation =
					domService.simplifiedDOMState?.flattenedDOM ||
					"No DOM tree available";

				const response: GetFlattenDOMToolResultSuccess = {
					tabId: tabId,
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

// Tool names enum for type safety
export enum DOMToolNames {
	GET_DOM_TREE = "get_dom_tree",
	RESET_DOM_TREE = "reset_dom_tree",
	GENERATE_LLM_REPRESENTATION = "generate_llm_representation",
	GET_DOM_STATUS = "get_dom_status",
}
