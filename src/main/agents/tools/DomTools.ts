import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { ThreadViewService } from "@/services";
import { PQueueManager } from "@agents/utils";
import type { DOMState, PageInfo } from "@shared";

// Get clickable elements schema
const getClickableElementsSchema = z.object({
  viewId: z.string().describe("The ID of the view to analyze"),
  highlightElements: z.boolean().optional().default(true).describe("Whether to highlight elements on the page"),
  focusElement: z.number().optional().default(-1).describe("Element index to focus specifically (-1 for no focus)"),
  viewportExpansion: z.number().optional().default(0).describe("Additional area around viewport to include in analysis"),
});

// Convert DOM elements to string schema
const clickableElementsToStringSchema = z.object({
  viewId: z.string().describe("The ID of the view to analyze"),
  includeAttributes: z.array(z.string()).optional().describe("Array of attribute names to include in output. Uses sensible defaults if not provided"),
});

// Get page info schema
const getPageInfoSchema = z.object({
  viewId: z.string().describe("The ID of the view to get page information for"),
});

// Hash DOM element schema
const hashDomElementSchema = z.object({
  viewId: z.string().describe("The ID of the view containing the element"),
  elementXpath: z.string().describe("XPath of the element to generate hash for"),
});

// Update element cache schema
const updateElementCacheSchema = z.object({
  viewId: z.string().describe("The ID of the view to update cache for"),
  url: z.string().describe("Current page URL for cache identification"),
});

// Clear element cache schema
const clearElementCacheSchema = z.object({
  viewId: z.string().describe("The ID of the view to clear cache for"),
  url: z.string().optional().describe("Specific URL to clear, or clear all cached URLs if not provided"),
});

// Compare DOM states schema
const compareDOMStatesSchema = z.object({
  viewId: z.string().describe("The ID of the view to compare"),
  previousDomStateJson: z.string().describe("Serialized previous DOM state JSON for comparison"),
});

// Tool execution with p-queue
const executeWithQueue = async <T>(
  task: () => Promise<T>,
  operationName: string
): Promise<T> => {
  try {
    return await PQueueManager.getInstance().add(task, {
      timeout: 20000, // 20 seconds timeout for DOM operations
      throwOnTimeout: true,
    });
  } catch (error) {
    throw new Error(
      `${operationName} failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
};

// Helper function to get DomService for a view
const getDomServiceForView = async (viewId: string) => {
  const threadViewService = ThreadViewService.getInstance();
  const domService = threadViewService.getDomService(viewId);

  if (!domService) {
    throw new Error(`DOM service not found for view ${viewId}. Make sure the view exists and is properly initialized.`);
  }

  return domService;
};

// Get clickable elements tool
export const getClickableElementsTool = tool(
  async (input): Promise<string> => {
    const { viewId, highlightElements, focusElement, viewportExpansion } = input as z.infer<typeof getClickableElementsSchema>;
    return executeWithQueue(async () => {
      try {
        const domService = await getDomServiceForView(viewId);
        const domState = await domService.getClickableElements(highlightElements, focusElement, viewportExpansion);

        const result = {
          success: true,
          viewId,
          totalElements: Object.keys(domState.selectorMap).length,
          domState: {
            elementTree: domState.elementTree,
            selectorMap: domState.selectorMap,
          },
          metadata: {
            highlightElements,
            focusElement,
            viewportExpansion,
            timestamp: new Date().toISOString(),
          },
        };

        return JSON.stringify(result, null, 2);
      } catch (error) {
        const errorResult = {
          success: false,
          viewId,
          error: error instanceof Error ? error.message : String(error),
          metadata: {
            highlightElements,
            focusElement,
            viewportExpansion,
            timestamp: new Date().toISOString(),
          },
        };
        return JSON.stringify(errorResult, null, 2);
      }
    }, `Get clickable elements for view ${viewId}`);
  },
  {
    name: "get_clickable_elements",
    description: "Extract all clickable/interactive elements from a web page and return structured DOM information",
    schema: getClickableElementsSchema,
  }
);

// Convert DOM elements to string tool
export const clickableElementsToStringTool = tool(
  async (input): Promise<string> => {
    const { viewId, includeAttributes } = input as z.infer<typeof clickableElementsToStringSchema>;
    return executeWithQueue(async () => {
      try {
        const domService = await getDomServiceForView(viewId);

        // First get the clickable elements
        const domState = await domService.getClickableElements(true, -1, 0);

        // Convert to string representation
        const elementsString = domService.clickableElementsToString(domState.elementTree, includeAttributes);

        const result = {
          success: true,
          viewId,
          totalElements: Object.keys(domState.selectorMap).length,
          elementsString,
          includeAttributes: includeAttributes || "default attributes",
          metadata: {
            timestamp: new Date().toISOString(),
          },
        };

        return JSON.stringify(result, null, 2);
      } catch (error) {
        const errorResult = {
          success: false,
          viewId,
          error: error instanceof Error ? error.message : String(error),
          includeAttributes: includeAttributes || "default attributes",
          metadata: {
            timestamp: new Date().toISOString(),
          },
        };
        return JSON.stringify(errorResult, null, 2);
      }
    }, `Convert DOM elements to string for view ${viewId}`);
  },
  {
    name: "clickable_elements_to_string",
    description: "Convert DOM elements to a human-readable string format optimized for AI consumption",
    schema: clickableElementsToStringSchema,
  }
);

// Get page info tool
export const getPageInfoTool = tool(
  async (input): Promise<string> => {
    const { viewId } = input as z.infer<typeof getPageInfoSchema>;
    return executeWithQueue(async () => {
      try {
        const domService = await getDomServiceForView(viewId);
        const pageInfo = await domService.getPageInfo();

        const result = {
          success: true,
          viewId,
          pageInfo: {
            // Viewport dimensions
            viewportWidth: pageInfo.viewportWidth,
            viewportHeight: pageInfo.viewportHeight,

            // Total page dimensions
            pageWidth: pageInfo.pageWidth,
            pageHeight: pageInfo.pageHeight,

            // Current scroll position
            scrollX: pageInfo.scrollX,
            scrollY: pageInfo.scrollY,

            // Calculated scroll information
            pixelsAbove: pageInfo.pixelsAbove,
            pixelsBelow: pageInfo.pixelsBelow,
            pixelsLeft: pageInfo.pixelsLeft,
            pixelsRight: pageInfo.pixelsRight,

            // Additional context
            scrollPercentage: Math.round((pageInfo.scrollY / (pageInfo.pageHeight - pageInfo.viewportHeight)) * 100),
            hasVerticalScroll: pageInfo.pageHeight > pageInfo.viewportHeight,
            hasHorizontalScroll: pageInfo.pageWidth > pageInfo.viewportWidth,
          },
          metadata: {
            timestamp: new Date().toISOString(),
          },
        };

        return JSON.stringify(result, null, 2);
      } catch (error) {
        const errorResult = {
          success: false,
          viewId,
          error: error instanceof Error ? error.message : String(error),
          metadata: {
            timestamp: new Date().toISOString(),
          },
        };
        return JSON.stringify(errorResult, null, 2);
      }
    }, `Get page information for view ${viewId}`);
  },
  {
    name: "get_page_info",
    description: "Get comprehensive page information including dimensions, scroll position, and viewport context",
    schema: getPageInfoSchema,
  }
);

// Hash DOM element tool
export const hashDomElementTool = tool(
  async (input): Promise<string> => {
    const { viewId, elementXpath } = input as z.infer<typeof hashDomElementSchema>;
    return executeWithQueue(async () => {
      try {
        const domService = await getDomServiceForView(viewId);

        // Get the DOM state to find the element by XPath
        const domState = await domService.getClickableElements(true, -1, 0);

        // Find the element by XPath
        const findElementByXpath = (node: any, xpath: string): any => {
          if (node.xpath === xpath) {
            return node;
          }
          if (node.children) {
            for (const child of node.children) {
              const found = findElementByXpath(child, xpath);
              if (found) return found;
            }
          }
          return null;
        };

        const element = findElementByXpath(domState.elementTree, elementXpath);

        if (!element) {
          throw new Error(`Element with XPath "${elementXpath}" not found in the page`);
        }

        // Generate hash for the element
        const elementHash = domService.hashDomElement(element);

        const result = {
          success: true,
          viewId,
          elementXpath,
          elementHash,
          elementInfo: {
            tagName: element.tagName,
            isVisible: element.isVisible,
            isInteractive: element.isInteractive,
            highlightIndex: element.highlightIndex,
          },
          metadata: {
            timestamp: new Date().toISOString(),
          },
        };

        return JSON.stringify(result, null, 2);
      } catch (error) {
        const errorResult = {
          success: false,
          viewId,
          elementXpath,
          error: error instanceof Error ? error.message : String(error),
          metadata: {
            timestamp: new Date().toISOString(),
          },
        };
        return JSON.stringify(errorResult, null, 2);
      }
    }, `Hash DOM element for view ${viewId}`);
  },
  {
    name: "hash_dom_element",
    description: "Generate a unique hash fingerprint for a DOM element using its XPath for element tracking",
    schema: hashDomElementSchema,
  }
);

// Update element cache tool
export const updateElementCacheTool = tool(
  async (input): Promise<string> => {
    const { viewId, url } = input as z.infer<typeof updateElementCacheSchema>;
    return executeWithQueue(async () => {
      try {
        const domService = await getDomServiceForView(viewId);

        // Get the current DOM state
        const domState = await domService.getClickableElements(true, -1, 0);

        // Update the element cache
        domService.updateElementCache(url, domState.elementTree);

        // Count new and total elements
        let newElementCount = 0;
        let totalElementCount = 0;

        const countElements = (node: any) => {
          if (node.highlightIndex !== null && node.highlightIndex !== undefined) {
            totalElementCount++;
            if (node.isNew) {
              newElementCount++;
            }
          }
          if (node.children) {
            for (const child of node.children) {
              countElements(child);
            }
          }
        };

        countElements(domState.elementTree);

        const result = {
          success: true,
          viewId,
          url,
          totalElements: totalElementCount,
          newElements: newElementCount,
          cacheUpdated: true,
          metadata: {
            timestamp: new Date().toISOString(),
          },
        };

        return JSON.stringify(result, null, 2);
      } catch (error) {
        const errorResult = {
          success: false,
          viewId,
          url,
          error: error instanceof Error ? error.message : String(error),
          cacheUpdated: false,
          metadata: {
            timestamp: new Date().toISOString(),
          },
        };
        return JSON.stringify(errorResult, null, 2);
      }
    }, `Update element cache for view ${viewId}`);
  },
  {
    name: "update_element_cache",
    description: "Update the element cache for change tracking and identify new elements on the page",
    schema: updateElementCacheSchema,
  }
);

// Clear element cache tool
export const clearElementCacheTool = tool(
  async (input): Promise<string> => {
    const { viewId, url } = input as z.infer<typeof clearElementCacheSchema>;
    return executeWithQueue(async () => {
      try {
        const domService = await getDomServiceForView(viewId);

        // Clear the element cache (for specific URL or all)
        domService.clearElementCache(url);

        const result = {
          success: true,
          viewId,
          clearedUrl: url || "all URLs",
          cacheCleared: true,
          metadata: {
            timestamp: new Date().toISOString(),
          },
        };

        return JSON.stringify(result, null, 2);
      } catch (error) {
        const errorResult = {
          success: false,
          viewId,
          clearedUrl: url || "all URLs",
          error: error instanceof Error ? error.message : String(error),
          cacheCleared: false,
          metadata: {
            timestamp: new Date().toISOString(),
          },
        };
        return JSON.stringify(errorResult, null, 2);
      }
    }, `Clear element cache for view ${viewId}`);
  },
  {
    name: "clear_element_cache",
    description: "Clear the element hash cache for a specific URL or all cached URLs",
    schema: clearElementCacheSchema,
  }
);

// Compare DOM states tool
export const compareDOMStatesTool = tool(
  async (input): Promise<string> => {
    const { viewId, previousDomStateJson } = input as z.infer<typeof compareDOMStatesSchema>;
    return executeWithQueue(async () => {
      try {
        const domService = await getDomServiceForView(viewId);

        // Parse the previous DOM state
        let previousDomState: DOMState;
        try {
          previousDomState = JSON.parse(previousDomStateJson);
        } catch (parseError) {
          throw new Error(`Failed to parse previous DOM state JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
        }

        // Get the current DOM state
        const currentDomState = await domService.getClickableElements(true, -1, 0);

        // Compare the DOM states
        const domDiff = domService.compareDOMStates(previousDomState, currentDomState);

        const result = {
          success: true,
          viewId,
          comparison: {
            addedElements: {
              count: domDiff.addedElements.length,
              elements: domDiff.addedElements.map(el => ({
                tagName: el.tagName,
                xpath: el.xpath,
                highlightIndex: el.highlightIndex,
                isNew: el.isNew,
              })),
            },
            removedElements: {
              count: domDiff.removedElements.length,
              elements: domDiff.removedElements.map(el => ({
                tagName: el.tagName,
                xpath: el.xpath,
                highlightIndex: el.highlightIndex,
              })),
            },
            unchangedElements: {
              count: domDiff.unchangedElements.length,
            },
            modifiedElements: {
              count: domDiff.modifiedElements.length,
              elements: domDiff.modifiedElements.map(el => ({
                tagName: el.tagName,
                xpath: el.xpath,
                highlightIndex: el.highlightIndex,
              })),
            },
          },
          summary: {
            totalChanges: domDiff.addedElements.length + domDiff.removedElements.length + domDiff.modifiedElements.length,
            hasChanges: domDiff.addedElements.length > 0 || domDiff.removedElements.length > 0 || domDiff.modifiedElements.length > 0,
            currentTotalElements: Object.keys(currentDomState.selectorMap).length,
            previousTotalElements: Object.keys(previousDomState.selectorMap).length,
          },
          metadata: {
            timestamp: new Date().toISOString(),
          },
        };

        return JSON.stringify(result, null, 2);
      } catch (error) {
        const errorResult = {
          success: false,
          viewId,
          error: error instanceof Error ? error.message : String(error),
          metadata: {
            timestamp: new Date().toISOString(),
          },
        };
        return JSON.stringify(errorResult, null, 2);
      }
    }, `Compare DOM states for view ${viewId}`);
  },
  {
    name: "compare_dom_states",
    description: "Compare two DOM states to identify added, removed, modified, and unchanged elements",
    schema: compareDOMStatesSchema,
  }
);

// Export all tools as an array for easy agent integration
export const domTools = [
  getClickableElementsTool,
  clickableElementsToStringTool,
  getPageInfoTool,
  hashDomElementTool,
  updateElementCacheTool,
  clearElementCacheTool,
  compareDOMStatesTool,
];

// Type definitions for tool results
export type GetClickableElementsResult = string;
export type ClickableElementsToStringResult = string;
export type GetPageInfoResult = string;
export type HashDomElementResult = string;
export type UpdateElementCacheResult = string;
export type ClearElementCacheResult = string;
export type CompareDOMStatesResult = string;

// Tool names enum for type safety
export enum DomToolNames {
  GET_CLICKABLE_ELEMENTS = "get_clickable_elements",
  CLICKABLE_ELEMENTS_TO_STRING = "clickable_elements_to_string",
  GET_PAGE_INFO = "get_page_info",
  HASH_DOM_ELEMENT = "hash_dom_element",
  UPDATE_ELEMENT_CACHE = "update_element_cache",
  CLEAR_ELEMENT_CACHE = "clear_element_cache",
  COMPARE_DOM_STATES = "compare_dom_states",
}