import { tool } from "ai";
import { z } from "zod";
import { SessionTabService } from "@/services";
import { PQueueManager } from "@agents/utils";
import type {
  ClickOptions,
  FillOptions,
  SelectOptionOptions,
  HoverOptions,
  DragOptions,
  ScrollOptions,
  ScrollAtCoordinateOptions,
  Position,
  ClickResult,
  FillResult,
  SelectOptionResult,
  HoverResult,
  DragResult,
  ScrollResult,
  GetAttributeResult,
  EvaluateResult,
  GetBasicInfoResult,
} from "@shared/dom/interaction";
import type { ToolExecutionContext } from "./types/context";

// ===== Result Types =====

/**
 * Enhanced tool results with DOM change tracking
 */
export interface ClickToolResult extends ClickResult {
  tabId: string;
  newNodesCount?: number;
  totalNodesCountChange?: number;
  timestamp?: number;
}

export interface FillToolResult extends FillResult {
  tabId: string;
  newNodesCount?: number;
  totalNodesCountChange?: number;
  timestamp?: number;
}

export interface SelectToolResult extends SelectOptionResult {
  tabId: string;
  newNodesCount?: number;
  totalNodesCountChange?: number;
  timestamp?: number;
}

export interface HoverToolResult extends HoverResult {
  tabId: string;
  newNodesCount?: number;
  totalNodesCountChange?: number;
  timestamp?: number;
}

export interface DragToolResult extends DragResult {
  tabId: string;
  newNodesCount?: number;
  totalNodesCountChange?: number;
  timestamp?: number;
}

export interface ScrollToolResult extends ScrollResult {
  tabId: string;
  newNodesCount?: number;
  totalNodesCountChange?: number;
  timestamp?: number;
}

export type GetAttributeToolResult = GetAttributeResult;
export type EvaluateToolResult = EvaluateResult;
export type GetBasicInfoToolResult = GetBasicInfoResult;

// Click Element Tool
export const clickElementTool = tool({
  description: "Click on an element using its backend node ID",
  inputSchema: z.object({
    backendNodeId: z
      .number()
      .describe("Required (number): Backend node ID of the element to click"),
  }),
  execute: async ({ backendNodeId }, { experimental_context }) => {
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
        const interactionService = sessionTabService.getInteractionService(
          context.activeTabId!,
        );
        if (!interactionService) {
          throw new Error(
            `Interaction service not found for tab ${context.activeTabId}`,
          );
        }

        // Simple left click options
        const options: ClickOptions = {
          button: "left",
          clickCount: 1,
        };

        // Record timestamp before the operation
        sessionTabService.updateTabTimestamp(context.activeTabId!);

        // Execute original click operation
        const clickResult = await interactionService.clickElement(
          backendNodeId,
          options,
        );

        // Add automatic DOM refresh
        if (clickResult.success) {
          try {
            // Wait for DOM changes to settle
            await new Promise((resolve) => setTimeout(resolve, 1000));

            // Get DOM service and refresh
            const domService = sessionTabService.getDomService(
              context.activeTabId!,
            );
            if (domService) {
              const { newNodesCount, totalNodesCountChange } =
                await domService.buildSimplifiedDOMTree();

              // Return combined result
              return {
                ...clickResult,
                tabId: context.activeTabId!,
                newNodesCount,
                totalNodesCountChange,
              };
            }
          } catch (refreshError) {
            console.warn(
              `DOM refresh failed for tab ${context.activeTabId}:`,
              refreshError,
            );
          }
        }

        // Return result without refresh data
        return {
          ...clickResult,
          tabId: context.activeTabId!,
          newNodesCount: 0,
          totalNodesCountChange: 0,
        } as ClickToolResult;
      },
      {
        timeout: 60000,
        throwOnTimeout: true,
      },
    );
  },
});

// Fill Element Tool
export const fillElementTool = tool({
  description: "Fill an input element with text using human-like typing",
  inputSchema: z.object({
    backendNodeId: z
      .number()
      .describe("Required (number): Backend node ID of the input element"),
    value: z.string().describe("Required (string): Text to fill in the input"),
    clear: z
      .boolean()
      .optional()
      .describe("Clear existing text before typing (default: true)"),
    keystrokeDelay: z
      .number()
      .optional()
      .describe("Delay between keystrokes in ms (default: 18)"),
  }),
  execute: async (
    { backendNodeId, value, clear = true, keystrokeDelay = 18 },
    { experimental_context },
  ) => {
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
        const interactionService = sessionTabService.getInteractionService(
          context.activeTabId!,
        );

        if (!interactionService) {
          throw new Error(
            `Interaction service not found for tab ${context.activeTabId}`,
          );
        }

        const options: FillOptions = {
          value,
          clear,
          keystrokeDelay,
        };

        // Record timestamp before the operation
        sessionTabService.updateTabTimestamp(context.activeTabId!);

        // Execute original fill operation
        const fillResult = await interactionService.fillElement(
          backendNodeId,
          options,
        );

        // Add automatic DOM refresh
        if (fillResult.success) {
          try {
            // Wait for DOM changes to settle
            await new Promise((resolve) => setTimeout(resolve, 500));

            // Get DOM service and refresh
            const domService = sessionTabService.getDomService(
              context.activeTabId!,
            );
            if (domService) {
              const { newNodesCount, totalNodesCountChange } =
                await domService.buildSimplifiedDOMTree();

              // Return combined result
              return {
                ...fillResult,
                tabId: context.activeTabId!,
                newNodesCount,
                totalNodesCountChange,
              };
            }
          } catch (refreshError) {
            console.warn(
              `DOM refresh failed for tab ${context.activeTabId}:`,
              refreshError,
            );
          }
        }

        // Return result without refresh data
        return {
          ...fillResult,
          tabId: context.activeTabId!,
          newNodesCount: 0,
          totalNodesCountChange: 0,
        } as FillToolResult;
      },
      {
        timeout: 60000,
        throwOnTimeout: true,
      },
    );
  },
});

// Select Option Tool
export const selectOptionTool = tool({
  description: "Select option(s) in a select element by value or text",
  inputSchema: z.object({
    backendNodeId: z
      .number()
      .describe("Required (number): Backend node ID of the select element"),
    values: z
      .union([z.string(), z.array(z.string())])
      .describe(
        "Required (string | string[]): Single value or array of values to select",
      ),
    clear: z
      .boolean()
      .optional()
      .describe("Clear existing selections (default: true)"),
    timeout: z.number().optional().describe("Timeout in ms (default: 5000)"),
  }),
  execute: async (
    { backendNodeId, values, clear = true, timeout = 5000 },
    { experimental_context },
  ) => {
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
        const interactionService = sessionTabService.getInteractionService(
          context.activeTabId!,
        );

        if (!interactionService) {
          throw new Error(
            `Interaction service not found for tab ${context.activeTabId}`,
          );
        }

        const options: SelectOptionOptions = {
          values,
          clear,
          timeout,
        };

        // Record timestamp before the operation
        sessionTabService.updateTabTimestamp(context.activeTabId!);

        // Execute original select option operation
        const selectResult = await interactionService.selectOption(
          backendNodeId,
          options,
        );

        // Add automatic DOM refresh
        if (selectResult.success) {
          try {
            // Wait for DOM changes to settle
            await new Promise((resolve) => setTimeout(resolve, 800));

            // Get DOM service and refresh
            const domService = sessionTabService.getDomService(
              context.activeTabId!,
            );
            if (domService) {
              const { newNodesCount, totalNodesCountChange } =
                await domService.buildSimplifiedDOMTree();

              // Return combined result
              return {
                ...selectResult,
                tabId: context.activeTabId!,
                newNodesCount,
                totalNodesCountChange,
              };
            }
          } catch (refreshError) {
            console.warn(
              `DOM refresh failed for tab ${context.activeTabId}:`,
              refreshError,
            );
          }
        }

        // Return result without refresh data
        return {
          ...selectResult,
          tabId: context.activeTabId!,
          newNodesCount: 0,
          totalNodesCountChange: 0,
        } as SelectToolResult;
      },
      {
        timeout: 60000,
        throwOnTimeout: true,
      },
    );
  },
});

// Hover Element Tool
export const hoverElementTool = tool({
  description: "Hover over an element using its backend node ID",
  inputSchema: z.object({
    backendNodeId: z
      .number()
      .describe("Required (number): Backend node ID of the element to hover"),
    timeout: z.number().optional().describe("Timeout in ms (default: 3000)"),
  }),
  execute: async (
    { backendNodeId, timeout = 3000 },
    { experimental_context },
  ) => {
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
        const interactionService = sessionTabService.getInteractionService(
          context.activeTabId!,
        );

        if (!interactionService) {
          throw new Error(
            `Interaction service not found for tab ${context.activeTabId}`,
          );
        }

        const options: HoverOptions = {
          timeout,
        };

        // Record timestamp before the operation
        sessionTabService.updateTabTimestamp(context.activeTabId!);

        // Execute original hover operation
        const hoverResult = await interactionService.hoverElement(
          backendNodeId,
          options,
        );

        // Add automatic DOM refresh
        if (hoverResult.success) {
          try {
            // Wait for DOM changes to settle
            await new Promise((resolve) => setTimeout(resolve, 300));

            // Get DOM service and refresh
            const domService = sessionTabService.getDomService(
              context.activeTabId!,
            );
            if (domService) {
              const { newNodesCount, totalNodesCountChange } =
                await domService.buildSimplifiedDOMTree();

              // Return combined result
              return {
                ...hoverResult,
                tabId: context.activeTabId!,
                newNodesCount,
                totalNodesCountChange,
              };
            }
          } catch (refreshError) {
            console.warn(
              `DOM refresh failed for tab ${context.activeTabId}:`,
              refreshError,
            );
          }
        }

        // Return result without refresh data
        return {
          ...hoverResult,
          tabId: context.activeTabId!,
          newNodesCount: 0,
          totalNodesCountChange: 0,
        } as HoverToolResult;
      },
      {
        timeout: 60000,
        throwOnTimeout: true,
      },
    );
  },
});

// Drag to Element Tool
export const dragToElementTool = tool({
  description: "Drag from one element to a target position or element",
  inputSchema: z.object({
    sourceBackendNodeId: z
      .number()
      .describe("Required (number): Backend node ID of the source element"),
    target: z
      .union([
        z.object({
          x: z.number(),
          y: z.number(),
        }),
        z.number(),
      ])
      .describe(
        "Required ({x: number, y: number} | number): Target position {x, y} or backend node ID of target element",
      ),
  }),
  execute: async (
    { sourceBackendNodeId, target },
    { experimental_context },
  ) => {
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
        const interactionService = sessionTabService.getInteractionService(
          context.activeTabId!,
        );

        if (!interactionService) {
          throw new Error(
            `Interaction service not found for tab ${context.activeTabId}`,
          );
        }

        const options: DragOptions = {
          target: target as Position | number,
        };

        // Record timestamp before the operation
        sessionTabService.updateTabTimestamp(context.activeTabId!);

        // Execute original drag operation
        const dragResult = await interactionService.dragToElement(
          sourceBackendNodeId,
          options,
        );

        // Add automatic DOM refresh
        if (dragResult.success) {
          try {
            // Wait for DOM changes to settle
            await new Promise((resolve) => setTimeout(resolve, 1200));

            // Get DOM service and refresh
            const domService = sessionTabService.getDomService(
              context.activeTabId!,
            );
            if (domService) {
              const { newNodesCount, totalNodesCountChange } =
                await domService.buildSimplifiedDOMTree();

              // Return combined result
              return {
                ...dragResult,
                tabId: context.activeTabId!,
                newNodesCount,
                totalNodesCountChange,
              };
            }
          } catch (refreshError) {
            console.warn(
              `DOM refresh failed for tab ${context.activeTabId}:`,
              refreshError,
            );
          }
        }

        // Return result without refresh data
        return {
          ...dragResult,
          tabId: context.activeTabId!,
          newNodesCount: 0,
          totalNodesCountChange: 0,
        } as DragToolResult;
      },
      {
        timeout: 60000,
        throwOnTimeout: true,
      },
    );
  },
});

// Scroll Pages Tool
export const scrollPagesTool = tool({
  description: "Scroll the page by number of pages",
  inputSchema: z.object({
    direction: z
      .enum(["up", "down"])
      .optional()
      .describe("Scroll direction (default: down)"),
    pages: z
      .number()
      .optional()
      .describe("Number of pages to scroll (default: 1.0)"),
    scrollDelay: z
      .number()
      .optional()
      .describe("Delay between scrolls in ms (default: 300)"),
    smooth: z
      .boolean()
      .optional()
      .describe("Whether to scroll smoothly (default: true)"),
  }),
  execute: async (
    { direction = "down", pages = 1.0, scrollDelay = 300, smooth = true },
    { experimental_context },
  ) => {
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
        const interactionService = sessionTabService.getInteractionService(
          context.activeTabId!,
        );

        if (!interactionService) {
          throw new Error(
            `Interaction service not found for tab ${context.activeTabId}`,
          );
        }

        const options: ScrollOptions = {
          direction,
          pages,
          scrollDelay,
          smooth,
        };

        // Record timestamp before the operation
        sessionTabService.updateTabTimestamp(context.activeTabId!);

        // Execute original scroll operation
        const scrollResult = await interactionService.scrollPages(options);

        // Add automatic DOM refresh
        if (scrollResult.success) {
          try {
            // Wait for DOM changes to settle
            await new Promise((resolve) => setTimeout(resolve, 400));

            // Get DOM service and refresh
            const domService = sessionTabService.getDomService(
              context.activeTabId!,
            );
            if (domService) {
              const { newNodesCount, totalNodesCountChange } =
                await domService.buildSimplifiedDOMTree();

              // Return combined result
              return {
                ...scrollResult,
                tabId: context.activeTabId!,
                newNodesCount,
                totalNodesCountChange,
              };
            }
          } catch (refreshError) {
            console.warn(
              `DOM refresh failed for tab ${context.activeTabId}:`,
              refreshError,
            );
          }
        }

        // Return result without refresh data
        return {
          ...scrollResult,
          tabId: context.activeTabId!,
          newNodesCount: 0,
          totalNodesCountChange: 0,
        } as ScrollToolResult;
      },
      {
        timeout: 60000,
        throwOnTimeout: true,
      },
    );
  },
});

// Scroll at Coordinate Tool
export const scrollAtCoordinateTool = tool({
  description: "Scroll at specific coordinates with delta values",
  inputSchema: z.object({
    x: z
      .number()
      .describe("Required (number): X coordinate relative to viewport"),
    y: z
      .number()
      .describe("Required (number): Y coordinate relative to viewport"),
    deltaX: z
      .number()
      .optional()
      .describe("Horizontal scroll delta (default: 0)"),
    deltaY: z
      .number()
      .optional()
      .describe("Vertical scroll delta (default: 0)"),
  }),
  execute: async (
    { x, y, deltaX = 0, deltaY = 0 },
    { experimental_context },
  ) => {
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
        const interactionService = sessionTabService.getInteractionService(
          context.activeTabId!,
        );

        if (!interactionService) {
          throw new Error(
            `Interaction service not found for tab ${context.activeTabId}`,
          );
        }

        const options: ScrollAtCoordinateOptions = {
          x,
          y,
          deltaX,
          deltaY,
        };

        // Record timestamp before the operation
        sessionTabService.updateTabTimestamp(context.activeTabId!);

        // Execute original scroll operation
        const scrollResult =
          await interactionService.scrollAtCoordinate(options);

        // Add automatic DOM refresh
        if (scrollResult.success) {
          try {
            // Wait for DOM changes to settle
            await new Promise((resolve) => setTimeout(resolve, 400));

            // Get DOM service and refresh
            const domService = sessionTabService.getDomService(
              context.activeTabId!,
            );
            if (domService) {
              const { newNodesCount, totalNodesCountChange } =
                await domService.buildSimplifiedDOMTree();

              // Return combined result
              return {
                ...scrollResult,
                tabId: context.activeTabId!,
                newNodesCount,
                totalNodesCountChange,
              };
            }
          } catch (refreshError) {
            console.warn(
              `DOM refresh failed for tab ${context.activeTabId}:`,
              refreshError,
            );
          }
        }

        // Return result without refresh data
        return {
          ...scrollResult,
          tabId: context.activeTabId!,
          newNodesCount: 0,
          totalNodesCountChange: 0,
        } as ScrollToolResult;
      },
      {
        timeout: 60000,
        throwOnTimeout: true,
      },
    );
  },
});

// Get Attribute Tool
export const getAttributeTool = tool({
  description: "Get an attribute value from an element",
  inputSchema: z.object({
    backendNodeId: z
      .number()
      .describe("Required (number): Backend node ID of the element"),
    attributeName: z
      .string()
      .describe("Required (string): Name of the attribute to retrieve"),
  }),
  execute: async (
    { backendNodeId, attributeName },
    { experimental_context },
  ) => {
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
        const interactionService = sessionTabService.getInteractionService(
          context.activeTabId!,
        );

        if (!interactionService) {
          throw new Error(
            `Interaction service not found for tab ${context.activeTabId}`,
          );
        }

        return await interactionService.getAttribute(
          backendNodeId,
          attributeName,
        );
      },
      {
        timeout: 60000,
        throwOnTimeout: true,
      },
    );
  },
});

// Evaluate Tool
export const evaluateTool = tool({
  description: "Evaluate JavaScript expression on an element",
  inputSchema: z.object({
    backendNodeId: z
      .number()
      .describe("Required (number): Backend node ID of the element"),
    expression: z
      .string()
      .describe(
        "Required (string): JavaScript expression in arrow function format: (args) => { ... }",
      ),
    args: z
      .array(z.any())
      .optional()
      .describe("Arguments to pass to the function (default: [])"),
  }),
  execute: async (
    { backendNodeId, expression, args = [] },
    { experimental_context },
  ) => {
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
        const interactionService = sessionTabService.getInteractionService(
          context.activeTabId!,
        );

        if (!interactionService) {
          throw new Error(
            `Interaction service not found for tab ${context.activeTabId}`,
          );
        }

        return await interactionService.evaluate(
          backendNodeId,
          expression,
          args,
        );
      },
      {
        timeout: 60000,
        throwOnTimeout: true,
      },
    );
  },
});

// Get Basic Info Tool
export const getBasicInfoTool = tool({
  description: "Get comprehensive information about an element",
  inputSchema: z.object({
    backendNodeId: z
      .number()
      .describe("Required (number): Backend node ID of the element"),
  }),
  execute: async ({ backendNodeId }, { experimental_context }) => {
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
        const interactionService = sessionTabService.getInteractionService(
          context.activeTabId!,
        );

        if (!interactionService) {
          throw new Error(
            `Interaction service not found for tab ${context.activeTabId}`,
          );
        }

        return await interactionService.getBasicInfo(backendNodeId);
      },
      {
        timeout: 60000,
        throwOnTimeout: true,
      },
    );
  },
});

// Export all tools as an object for AI SDK
export const interactiveTools = {
  clickElement: clickElementTool,
  fillElement: fillElementTool,
  selectOption: selectOptionTool,
  hoverElement: hoverElementTool,
  dragToElement: dragToElementTool,
  scrollPages: scrollPagesTool,
  scrollAtCoordinate: scrollAtCoordinateTool,
  getAttribute: getAttributeTool,
  evaluate: evaluateTool,
  getBasicInfo: getBasicInfoTool,
};
