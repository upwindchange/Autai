import { tool } from "ai";
import { z } from "zod";
import { ThreadViewService } from "@/services";
import { PQueueManager } from "@agents/utils";
import type {
  ClickOptions,
  ClickResult,
  FillOptions,
  FillResult,
  SelectOptionOptions,
  SelectOptionResult,
  HoverOptions,
  HoverResult,
  DragOptions,
  DragResult,
  GetAttributeResult,
  EvaluateResult,
  GetBasicInfoResult,
  ScrollOptions,
  ScrollAtCoordinateOptions,
  ScrollResult,
  MouseButton,
  ModifierType,
  Position,
} from "@shared/dom/interaction";

// Click Element Tool
export const clickElementTool = tool({
  description: "Click on an element using its backend node ID",
  inputSchema: z.object({
    viewId: z.string().describe("The ID of the view containing the element"),
    backendNodeId: z
      .number()
      .describe("Backend node ID of the element to click"),
    button: z
      .enum(["left", "right", "middle"])
      .optional()
      .default("left")
      .describe("Mouse button (default: left)"),
    clickCount: z
      .number()
      .optional()
      .default(1)
      .describe("Number of times to click (default: 1)"),
    modifiers: z
      .array(z.enum(["Alt", "Control", "Meta", "Shift"]))
      .optional()
      .describe("Modifier keys to hold"),
    timeout: z
      .number()
      .optional()
      .default(5000)
      .describe("Timeout in milliseconds (default: 5000)"),
  }),
  execute: async ({
    viewId,
    backendNodeId,
    button,
    clickCount,
    modifiers,
    timeout,
  }) => {
    return await PQueueManager.getInstance().add(
      async () => {
        const threadViewService = ThreadViewService.getInstance();
        const interactionService =
          threadViewService.getInteractionService(viewId);
        if (!interactionService) {
          throw new Error(`Interaction service not found for view ${viewId}`);
        }

        const options: ClickOptions = {
          button: button as MouseButton,
          clickCount,
          modifiers: modifiers as ModifierType[],
          timeout,
        };

        return await interactionService.clickElement(backendNodeId, options);
      },
      {
        timeout: 60000,
        throwOnTimeout: true,
      }
    );
  },
});

// Fill Element Tool
export const fillElementTool = tool({
  description: "Fill an input element with text using human-like typing",
  inputSchema: z.object({
    viewId: z.string().describe("The ID of the view containing the element"),
    backendNodeId: z.number().describe("Backend node ID of the input element"),
    value: z.string().describe("Text to fill in the input"),
    clear: z
      .boolean()
      .optional()
      .default(true)
      .describe("Clear existing text before typing (default: true)"),
    keystrokeDelay: z
      .number()
      .optional()
      .default(18)
      .describe("Delay between keystrokes in ms (default: 18)"),
  }),
  execute: async ({ viewId, backendNodeId, value, clear, keystrokeDelay }) => {
    return await PQueueManager.getInstance().add(
      async () => {
        const threadViewService = ThreadViewService.getInstance();
        const interactionService =
          threadViewService.getInteractionService(viewId);
        if (!interactionService) {
          throw new Error(`Interaction service not found for view ${viewId}`);
        }

        const options: FillOptions = {
          value,
          clear,
          keystrokeDelay,
        };

        return await interactionService.fillElement(backendNodeId, options);
      },
      {
        timeout: 60000,
        throwOnTimeout: true,
      }
    );
  },
});

// Select Option Tool
export const selectOptionTool = tool({
  description: "Select option(s) in a select element by value or text",
  inputSchema: z.object({
    viewId: z.string().describe("The ID of the view containing the element"),
    backendNodeId: z.number().describe("Backend node ID of the select element"),
    values: z
      .union([z.string(), z.array(z.string())])
      .describe("Single value or array of values to select"),
    clear: z
      .boolean()
      .optional()
      .default(true)
      .describe("Clear existing selections (default: true)"),
    timeout: z
      .number()
      .optional()
      .default(5000)
      .describe("Timeout in ms (default: 5000)"),
  }),
  execute: async ({ viewId, backendNodeId, values, clear, timeout }) => {
    return await PQueueManager.getInstance().add(
      async () => {
        const threadViewService = ThreadViewService.getInstance();
        const interactionService =
          threadViewService.getInteractionService(viewId);
        if (!interactionService) {
          throw new Error(`Interaction service not found for view ${viewId}`);
        }

        const options: SelectOptionOptions = {
          values,
          clear,
          timeout,
        };

        return await interactionService.selectOption(backendNodeId, options);
      },
      {
        timeout: 60000,
        throwOnTimeout: true,
      }
    );
  },
});

// Hover Element Tool
export const hoverElementTool = tool({
  description: "Hover over an element using its backend node ID",
  inputSchema: z.object({
    viewId: z.string().describe("The ID of the view containing the element"),
    backendNodeId: z
      .number()
      .describe("Backend node ID of the element to hover"),
    timeout: z
      .number()
      .optional()
      .default(3000)
      .describe("Timeout in ms (default: 3000)"),
  }),
  execute: async ({ viewId, backendNodeId, timeout }) => {
    return await PQueueManager.getInstance().add(
      async () => {
        const threadViewService = ThreadViewService.getInstance();
        const interactionService =
          threadViewService.getInteractionService(viewId);
        if (!interactionService) {
          throw new Error(`Interaction service not found for view ${viewId}`);
        }

        const options: HoverOptions = {
          timeout,
        };

        return await interactionService.hoverElement(backendNodeId, options);
      },
      {
        timeout: 60000,
        throwOnTimeout: true,
      }
    );
  },
});

// Drag to Element Tool
export const dragToElementTool = tool({
  description: "Drag from one element to another position or element",
  inputSchema: z.object({
    viewId: z.string().describe("The ID of the view containing the elements"),
    sourceBackendNodeId: z
      .number()
      .describe("Backend node ID of the source element"),
    target: z
      .union([
        z.object({
          x: z.number(),
          y: z.number(),
        }),
        z.number(),
      ])
      .describe("Target position or backend node ID of target element"),
    targetPosition: z
      .object({
        x: z.number(),
        y: z.number(),
      })
      .optional()
      .describe("Relative position when target is an element"),
  }),
  execute: async ({ viewId, sourceBackendNodeId, target, targetPosition }) => {
    return await PQueueManager.getInstance().add(
      async () => {
        const threadViewService = ThreadViewService.getInstance();
        const interactionService =
          threadViewService.getInteractionService(viewId);
        if (!interactionService) {
          throw new Error(`Interaction service not found for view ${viewId}`);
        }

        const options: DragOptions = {
          target: target as Position | number,
          targetPosition,
        };

        return await interactionService.dragToElement(
          sourceBackendNodeId,
          options
        );
      },
      {
        timeout: 60000,
        throwOnTimeout: true,
      }
    );
  },
});

// Scroll Pages Tool
export const scrollPagesTool = tool({
  description: "Scroll the page by number of pages",
  inputSchema: z.object({
    viewId: z.string().describe("The ID of the view to scroll"),
    direction: z
      .enum(["up", "down"])
      .optional()
      .default("down")
      .describe("Scroll direction (default: down)"),
    pages: z
      .number()
      .optional()
      .default(1.0)
      .describe("Number of pages to scroll (default: 1.0)"),
    scrollDelay: z
      .number()
      .optional()
      .default(300)
      .describe("Delay between scrolls in ms (default: 300)"),
    smooth: z
      .boolean()
      .optional()
      .default(true)
      .describe("Whether to scroll smoothly (default: true)"),
  }),
  execute: async ({ viewId, direction, pages, scrollDelay, smooth }) => {
    return await PQueueManager.getInstance().add(
      async () => {
        const threadViewService = ThreadViewService.getInstance();
        const interactionService =
          threadViewService.getInteractionService(viewId);
        if (!interactionService) {
          throw new Error(`Interaction service not found for view ${viewId}`);
        }

        const options: ScrollOptions = {
          direction,
          pages,
          scrollDelay,
          smooth,
        };

        return await interactionService.scrollPages(options);
      },
      {
        timeout: 60000,
        throwOnTimeout: true,
      }
    );
  },
});

// Scroll at Coordinate Tool
export const scrollAtCoordinateTool = tool({
  description: "Scroll at specific coordinates with delta values",
  inputSchema: z.object({
    viewId: z.string().describe("The ID of the view to scroll"),
    x: z.number().describe("X coordinate relative to viewport"),
    y: z.number().describe("Y coordinate relative to viewport"),
    deltaX: z
      .number()
      .optional()
      .default(0)
      .describe("Horizontal scroll delta (default: 0)"),
    deltaY: z
      .number()
      .optional()
      .default(0)
      .describe("Vertical scroll delta (default: 0)"),
  }),
  execute: async ({ viewId, x, y, deltaX, deltaY }) => {
    return await PQueueManager.getInstance().add(
      async () => {
        const threadViewService = ThreadViewService.getInstance();
        const interactionService =
          threadViewService.getInteractionService(viewId);
        if (!interactionService) {
          throw new Error(`Interaction service not found for view ${viewId}`);
        }

        const options: ScrollAtCoordinateOptions = {
          x,
          y,
          deltaX,
          deltaY,
        };

        return await interactionService.scrollAtCoordinate(options);
      },
      {
        timeout: 60000,
        throwOnTimeout: true,
      }
    );
  },
});

// Get Attribute Tool
export const getAttributeTool = tool({
  description: "Get an attribute value from an element",
  inputSchema: z.object({
    viewId: z.string().describe("The ID of the view containing the element"),
    backendNodeId: z.number().describe("Backend node ID of the element"),
    attributeName: z.string().describe("Name of the attribute to retrieve"),
  }),
  execute: async ({ viewId, backendNodeId, attributeName }) => {
    return await PQueueManager.getInstance().add(
      async () => {
        const threadViewService = ThreadViewService.getInstance();
        const interactionService =
          threadViewService.getInteractionService(viewId);
        if (!interactionService) {
          throw new Error(`Interaction service not found for view ${viewId}`);
        }

        return await interactionService.getAttribute(
          backendNodeId,
          attributeName
        );
      },
      {
        timeout: 60000,
        throwOnTimeout: true,
      }
    );
  },
});

// Evaluate Tool
export const evaluateTool = tool({
  description: "Evaluate JavaScript expression on an element",
  inputSchema: z.object({
    viewId: z.string().describe("The ID of the view containing the element"),
    backendNodeId: z.number().describe("Backend node ID of the element"),
    expression: z
      .string()
      .describe(
        "JavaScript expression in arrow function format: (args) => { ... }"
      ),
    args: z
      .array(z.any())
      .optional()
      .default([])
      .describe("Arguments to pass to the function"),
  }),
  execute: async ({ viewId, backendNodeId, expression, args }) => {
    return await PQueueManager.getInstance().add(
      async () => {
        const threadViewService = ThreadViewService.getInstance();
        const interactionService =
          threadViewService.getInteractionService(viewId);
        if (!interactionService) {
          throw new Error(`Interaction service not found for view ${viewId}`);
        }

        return await interactionService.evaluate(
          backendNodeId,
          expression,
          args
        );
      },
      {
        timeout: 60000,
        throwOnTimeout: true,
      }
    );
  },
});

// Get Basic Info Tool
export const getBasicInfoTool = tool({
  description: "Get comprehensive information about an element",
  inputSchema: z.object({
    viewId: z.string().describe("The ID of the view containing the element"),
    backendNodeId: z.number().describe("Backend node ID of the element"),
  }),
  execute: async ({ viewId, backendNodeId }) => {
    return await PQueueManager.getInstance().add(
      async () => {
        const threadViewService = ThreadViewService.getInstance();
        const interactionService =
          threadViewService.getInteractionService(viewId);
        if (!interactionService) {
          throw new Error(`Interaction service not found for view ${viewId}`);
        }

        return await interactionService.getBasicInfo(backendNodeId);
      },
      {
        timeout: 60000,
        throwOnTimeout: true,
      }
    );
  },
});

// Export all tools as a ToolSet for AI SDK
export const interactiveTools = {
  click_element: clickElementTool,
  fill_element: fillElementTool,
  select_option: selectOptionTool,
  hover_element: hoverElementTool,
  drag_to_element: dragToElementTool,
  scroll_pages: scrollPagesTool,
  scroll_at_coordinate: scrollAtCoordinateTool,
  get_attribute: getAttributeTool,
  evaluate: evaluateTool,
  get_basic_info: getBasicInfoTool,
} as const;

// Type definitions for tool results
export type ClickElementToolResult = ClickResult;
export type FillElementToolResult = FillResult;
export type SelectOptionToolResult = SelectOptionResult;
export type HoverElementToolResult = HoverResult;
export type DragToElementToolResult = DragResult;
export type ScrollPagesToolResult = ScrollResult;
export type ScrollAtCoordinateToolResult = ScrollResult;
export type GetAttributeToolResult = GetAttributeResult;
export type EvaluateToolResult = EvaluateResult;
export type GetBasicInfoToolResult = GetBasicInfoResult;

// Tool names enum for type safety
export enum InteractiveToolNames {
  CLICK_ELEMENT = "click_element",
  FILL_ELEMENT = "fill_element",
  SELECT_OPTION = "select_option",
  HOVER_ELEMENT = "hover_element",
  DRAG_TO_ELEMENT = "drag_to_element",
  SCROLL_PAGES = "scroll_pages",
  SCROLL_AT_COORDINATE = "scroll_at_coordinate",
  GET_ATTRIBUTE = "get_attribute",
  EVALUATE = "evaluate",
  GET_BASIC_INFO = "get_basic_info",
}
