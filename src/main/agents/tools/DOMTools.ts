/**
 * DOM Analysis Tools for AI Agents
 *
 * Exposes DOM utilities from DOMService and DOMTreeSerializer as AI tools
 * following the established pattern in the codebase
 */

import { tool } from "ai";
import { z } from "zod";
import { ThreadViewService } from "@/services";
import { PQueueManager } from "@agents/utils";
import type {
  EnhancedDOMTreeNode,
  SerializedDOMState,
  SerializationConfig,
  SerializationStats,
  SerializationTiming,
  SimplifiedNode,
} from "@shared/dom";

// Input schemas
const getDOMTreeSchema = z.object({
  viewId: z.string().describe("The ID of the view to analyze"),
});

const getSerializedDOMTreeSchema = z.object({
  viewId: z.string().describe("The ID of the view to analyze"),
});

const getDOMTreeWithChangeDetectionSchema = z.object({
  viewId: z.string().describe("The ID of the view to analyze"),
  forceDetect: z
    .boolean()
    .optional()
    .default(false)
    .describe("Force detection even without previous state"),
});

const generateLLMRepresentationSchema = z.object({
  viewId: z.string().describe("The ID of the view containing the element"),
  backendNodeId: z
    .number()
    .describe("Backend node ID of the element to analyze"),
  includeContext: z
    .boolean()
    .optional()
    .default(true)
    .describe("Include surrounding context in representation"),
});

const getDOMStatusSchema = z.object({
  viewId: z.string().describe("The ID of the view to check status for"),
});

// Tool implementation: Get DOM Tree
export const getDOMTreeTool = tool({
  description:
    "Check if DOM tree can be successfully retrieved for a view (returns success/failure status only)",
  inputSchema: getDOMTreeSchema,
  execute: async ({ viewId }) => {
    return await PQueueManager.getInstance().add(
      async () => {
        const threadViewService = ThreadViewService.getInstance();
        const domService = threadViewService.getDomService(viewId);

        if (!domService) {
          throw new Error(`DOM service not found for view ${viewId}`);
        }

        try {
          const domTree = await domService.getDOMTree();
          const nodeCount = countNodes(domTree);

          const result = {
            success: true,
            viewId,
            message: `DOM tree successfully retrieved with ${nodeCount} nodes`,
          };

          return JSON.stringify(result, null, 2);
        } catch (error) {
          const result = {
            success: false,
            viewId,
            message: `Failed to retrieve DOM tree: ${
              error instanceof Error ? error.message : String(error)
            }`,
          };
          return JSON.stringify(result, null, 2);
        }
      },
      {
        timeout: 30000,
        throwOnTimeout: true,
      }
    );
  },
});

// Tool implementation: Get Serialized DOM Tree
export const getSerializedDOMTreeTool = tool({
  description:
    "Get an optimized serialized DOM tree perfect for LLM analysis with filtering and optimization",
  inputSchema: getSerializedDOMTreeSchema,
  execute: async ({ viewId }) => {
    return await PQueueManager.getInstance().add(
      async () => {
        const threadViewService = ThreadViewService.getInstance();
        const domService = threadViewService.getDomService(viewId);

        if (!domService) {
          throw new Error(`DOM service not found for view ${viewId}`);
        }

        // Get previous state for incremental updates
        const previousState = domService.getPreviousState();

        // Use default configuration (no config passed)
        const result = await domService.getSerializedDOMTree(previousState);

        const response = {
          viewId,
          hasPreviousState: !!previousState,
          serializedState: {
            rootNode: simplifyNodeForAI(result.serializedState.root),
            interactiveElementsCount: result.stats.interactiveElements,
            totalNodes: result.stats.totalNodes,
            newElementsCount: result.stats.newElements,
          },
          timing: result.timing,
          stats: result.stats,
          llmRepresentation: (await result.serializedState.root)
            ? await domService.serializer.generateLLMRepresentation(
                result.serializedState.root
              )
            : "Representation not available",
        };

        return JSON.stringify(response, null, 2);
      },
      {
        timeout: 45000,
        throwOnTimeout: true,
      }
    );
  },
});

// Tool implementation: Get DOM Tree with Change Detection
export const getDOMTreeWithChangeDetectionTool = tool({
  description:
    "Get DOM tree with intelligent change detection to identify what has changed since last analysis",
  inputSchema: getDOMTreeWithChangeDetectionSchema,
  execute: async ({ viewId, forceDetect }) => {
    return await PQueueManager.getInstance().add(
      async () => {
        const threadViewService = ThreadViewService.getInstance();
        const domService = threadViewService.getDomService(viewId);

        if (!domService) {
          throw new Error(`DOM service not found for view ${viewId}`);
        }

        const previousState = forceDetect
          ? undefined
          : domService.getPreviousState();

        const result = await domService.getDOMTreeWithChangeDetection(
          previousState
        );

        const response = {
          viewId,
          isFirstRun: !previousState,
          hasChanges: result.hasChanges,
          changeCount: result.changeCount,
          newElements:
            result.hasChanges && result.serializedState
              ? extractNewElements(result.serializedState)
              : [],
          summary: generateChangeSummary(result),
          recommendations: generateChangeRecommendations(result),
        };

        return JSON.stringify(response, null, 2);
      },
      {
        timeout: 45000,
        throwOnTimeout: true,
      }
    );
  },
});

// Tool implementation: Generate LLM Representation
export const generateLLMRepresentationTool = tool({
  description:
    "Generate an LLM-optimized textual representation of a specific DOM element and its context",
  inputSchema: generateLLMRepresentationSchema,
  execute: async ({ viewId, backendNodeId, includeContext }) => {
    return await PQueueManager.getInstance().add(
      async () => {
        const threadViewService = ThreadViewService.getInstance();
        const domService = threadViewService.getDomService(viewId);

        if (!domService) {
          throw new Error(`DOM service not found for view ${viewId}`);
        }

        // Get full DOM tree to find the element
        const domTree = await domService.getDOMTree();
        const targetElement = findNodeById(domTree, backendNodeId);

        if (!targetElement) {
          throw new Error(
            `Element with backendNodeId ${backendNodeId} not found`
          );
        }

        // Create a simplified node for LLM representation
        const simplifiedNode: SimplifiedNode = {
          originalNode: targetElement,
          children: [],
          shouldDisplay: true,
          interactiveIndex: null,
          isNew: false,
          ignoredByPaintOrder: false,
          excludedByParent: false,
          isShadowHost: false,
          isCompoundComponent: false,
          hasCompoundChildren: false,
          isLeaf: false,
          depth: 0,
          nodeHash: 0,
          interactiveElement: targetElement.isActuallyScrollable || false,
          hasChildren:
            targetElement.children && targetElement.children.length > 0,
          tagName: targetElement.tagName || "",
          textContent: targetElement.nodeValue || "",
        };

        // Generate representation using the serializer
        const representation =
          await domService.serializer.generateLLMRepresentation(simplifiedNode);

        const response = {
          viewId,
          backendNodeId,
          element: {
            tagName: targetElement.tagName,
            textContent: targetElement.nodeValue?.substring(0, 200),
            attributes: targetElement.attributes,
            isInteractive:
              targetElement.isActuallyScrollable || targetElement.isVisible,
            position: targetElement.absolutePosition,
            nodeType: targetElement.nodeType,
          },
          context: includeContext
            ? extractElementContext(targetElement, 3)
            : null,
          llmRepresentation: representation,
          accessibilityInfo: extractAccessibilityInfo(targetElement),
        };

        return JSON.stringify(response, null, 2);
      },
      {
        timeout: 30000,
        throwOnTimeout: true,
      }
    );
  },
});

// Tool implementation: Get DOM Status
export const getDOMStatusTool = tool({
  description:
    "Get the current status of the DOM service for debugging and connection checks",
  inputSchema: getDOMStatusSchema,
  execute: async ({ viewId }) => {
    return await PQueueManager.getInstance().add(
      async () => {
        const threadViewService = ThreadViewService.getInstance();
        const domService = threadViewService.getDomService(viewId);

        if (!domService) {
          return JSON.stringify(
            {
              viewId,
              status: "NOT_FOUND",
              error: `DOM service not found for view ${viewId}`,
            },
            null,
            2
          );
        }

        const status = domService.getStatus();
        const previousState = domService.getPreviousState();

        const response = {
          viewId,
          serviceStatus: status,
          hasPreviousState: !!previousState,
          previousStateInfo: previousState
            ? {
                nodeCount: Object.keys(previousState.selectorMap).length,
                lastUpdated: new Date().toISOString(), // DOMService doesn't track timestamp
              }
            : null,
          recommendations: generateStatusRecommendations(status),
        };

        return JSON.stringify(response, null, 2);
      },
      {
        timeout: 5000,
        throwOnTimeout: true,
      }
    );
  },
});

// Helper functions

/**
 * Count total nodes in DOM tree
 */
function countNodes(node: EnhancedDOMTreeNode): number {
  let count = 1;
  for (const child of node.children || []) {
    count += countNodes(child);
  }
  return count;
}

/**
 * Simplify node for AI consumption
 */
function simplifyNodeForAI(node: SimplifiedNode): any {
  return {
    tagName: node.tagName,
    textContent: node.textContent?.substring(0, 100),
    isInteractive: node.interactiveElement,
    interactiveIndex: node.interactiveIndex,
    hasChildren: node.hasChildren,
    isNew: node.isNew,
    depth: node.depth,
  };
}

/**
 * Extract new elements from serialized state
 */
function extractNewElements(serializedState?: SerializedDOMState): any[] {
  if (!serializedState) return [];

  const newElements: any[] = [];

  function traverse(node: SimplifiedNode) {
    if (node.isNew && node.interactiveIndex !== null) {
      newElements.push({
        tagName: node.tagName,
        textContent: node.textContent?.substring(0, 50),
        interactiveIndex: node.interactiveIndex,
        backendNodeId: node.originalNode.backendNodeId,
      });
    }

    for (const child of node.children) {
      traverse(child);
    }
  }

  traverse(serializedState.root);
  return newElements.slice(0, 20); // Limit to 20 new elements
}

/**
 * Generate change summary
 */
function generateChangeSummary(result: any): string {
  if (!result.hasChanges) return "No changes detected since last analysis";
  return `${result.changeCount} changes detected since last analysis`;
}

/**
 * Generate change recommendations
 */
function generateChangeRecommendations(result: any): string[] {
  if (!result.hasChanges) {
    return ["DOM is stable - no action needed"];
  }

  const recommendations: string[] = [];

  if (result.changeCount > 0) {
    recommendations.push("Review new interactive elements");
    recommendations.push("Check if changes affect user interactions");

    if (result.changeCount > 10) {
      recommendations.push(
        "Consider re-analyzing the entire page for significant changes"
      );
    } else {
      recommendations.push("Changes are minimal - focus on affected areas");
    }
  }

  return recommendations;
}

/**
 * Find node by backendNodeId in DOM tree
 */
function findNodeById(
  node: EnhancedDOMTreeNode,
  backendNodeId: number
): EnhancedDOMTreeNode | null {
  if (node.backendNodeId === backendNodeId) {
    return node;
  }

  for (const child of node.children || []) {
    const found = findNodeById(child, backendNodeId);
    if (found) return found;
  }

  return null;
}

/**
 * Extract element context (parent and siblings)
 */
function extractElementContext(
  element: EnhancedDOMTreeNode,
  levels: number
): any {
  const context: any = {
    depth: calculateDepth(element),
  };

  if (element.parent) {
    context.parent = {
      tagName: element.parent.tagName,
      backendNodeId: element.parent.backendNodeId,
    };

    const siblings = element.parent.children || [];
    context.siblings = {
      total: siblings.length,
      position: siblings.findIndex(
        (child) => child.backendNodeId === element.backendNodeId
      ),
      nearbyElements: siblings
        .slice(
          Math.max(
            0,
            siblings.findIndex(
              (child) => child.backendNodeId === element.backendNodeId
            ) - 2
          ),
          siblings.findIndex(
            (child) => child.backendNodeId === element.backendNodeId
          ) + 3
        )
        .map((sibling) => ({
          tagName: sibling.tagName,
          backendNodeId: sibling.backendNodeId,
          textContent: sibling.nodeValue?.substring(0, 30),
        }))
        .filter((sibling) => sibling.backendNodeId !== element.backendNodeId),
    };
  }

  return context;
}

/**
 * Extract accessibility information from element
 */
function extractAccessibilityInfo(element: EnhancedDOMTreeNode): any {
  const info: any = {};

  if (element.axNode) {
    if (element.axNode.role) {
      info.role =
        typeof element.axNode.role === "string"
          ? element.axNode.role
          : element.axNode.role.value;
    }

    if (element.axNode.properties) {
      for (const prop of element.axNode.properties) {
        if (prop.name && prop.value !== null && prop.value !== undefined) {
          info[prop.name] = prop.value;
        }
      }
    }
  }

  return info;
}

/**
 * Generate status recommendations
 */
function generateStatusRecommendations(status: any): string[] {
  const recommendations: string[] = [];

  if (!status.isAttached) {
    recommendations.push(
      "DOM service is not attached - call initialize() first"
    );
  }

  if (!status.isInitialized) {
    recommendations.push(
      "DOM service is not initialized - check service setup"
    );
  }

  if (recommendations.length === 0) {
    recommendations.push("DOM service is ready for operations");
  }

  return recommendations;
}

/**
 * Calculate depth of element in DOM tree
 */
function calculateDepth(node: EnhancedDOMTreeNode): number {
  let depth = 0;
  let current = node.parent;
  while (current) {
    depth++;
    current = current.parent;
  }
  return depth;
}

// Export all tools as a ToolSet for AI SDK
export const domTools = {
  get_dom_tree: getDOMTreeTool,
  get_serialized_dom_tree: getSerializedDOMTreeTool,
  get_dom_tree_with_change_detection: getDOMTreeWithChangeDetectionTool,
  generate_llm_representation: generateLLMRepresentationTool,
  get_dom_status: getDOMStatusTool,
} as const;

// Type definitions for tool results
export type GetDOMTreeToolResult = string;
export type GetSerializedDOMTreeToolResult = string;
export type GetDOMTreeWithChangeDetectionToolResult = string;
export type GenerateLLMRepresentationToolResult = string;
export type GetDOMStatusToolResult = string;

// Tool names enum for type safety
export enum DOMToolNames {
  GET_DOM_TREE = "get_dom_tree",
  GET_SERIALIZED_DOM_TREE = "get_serialized_dom_tree",
  GET_DOM_TREE_WITH_CHANGE_DETECTION = "get_dom_tree_with_change_detection",
  GENERATE_LLM_REPRESENTATION = "generate_llm_representation",
  GET_DOM_STATUS = "get_dom_status",
}
