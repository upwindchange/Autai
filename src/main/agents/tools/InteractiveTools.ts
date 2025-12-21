import { tool } from "langchain";
import { z } from "zod";
import { SessionTabService } from "@/services";
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
	Position,
} from "@shared/dom/interaction";

// Click Element Tool
export const clickElementTool = tool(
	async ({ tabId, backendNodeId }) => {
		return await PQueueManager.getInstance().add(
			async () => {
				const sessionTabService = SessionTabService.getInstance();
				const interactionService =
					sessionTabService.getInteractionService(tabId);
				if (!interactionService) {
					throw new Error(`Interaction service not found for tab ${tabId}`);
				}

				// Simple left click options
				const options: ClickOptions = {
					button: "left",
					clickCount: 1,
				};

				// Record timestamp before the operation
				sessionTabService.updateTabTimestamp(tabId);

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
						const domService = sessionTabService.getDomService(tabId);
						if (domService) {
							const { newNodesCount, totalNodesCountChange } =
								await domService.buildSimplifiedDOMTree();

							// Return combined result
							return {
								...clickResult,
								tabId,
								newNodesCount,
								totalNodesCountChange,
							};
						}
					} catch (refreshError) {
						console.warn(`DOM refresh failed for tab ${tabId}:`, refreshError);
					}
				}

				// Return result without refresh data
				return {
					...clickResult,
					tabId,
					newNodesCount: 0,
					totalNodesCountChange: 0,
				};
			},
			{
				timeout: 60000,
				throwOnTimeout: true,
			},
		);
	},
	{
		name: "clickElementTool",
		description: "Click on an element using its backend node ID",
		schema: z.object({
			tabId: z.string().describe("The ID of the tab containing the element"),
			backendNodeId: z
				.number()
				.describe("Backend node ID of the element to click"),
		}),
	},
);

// Fill Element Tool
export const fillElementTool = tool(
	async ({
		tabId,
		backendNodeId,
		value,
		clear = true,
		keystrokeDelay = 18,
	}) => {
		return await PQueueManager.getInstance().add(
			async () => {
				const sessionTabService = SessionTabService.getInstance();
				const interactionService =
					sessionTabService.getInteractionService(tabId);
				if (!interactionService) {
					throw new Error(`Interaction service not found for tab ${tabId}`);
				}

				const options: FillOptions = {
					value,
					clear,
					keystrokeDelay,
				};

				// Record timestamp before the operation
				sessionTabService.updateTabTimestamp(tabId);

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
						const domService = sessionTabService.getDomService(tabId);
						if (domService) {
							const { newNodesCount, totalNodesCountChange } =
								await domService.buildSimplifiedDOMTree();

							// Return combined result
							return {
								...fillResult,
								tabId,
								newNodesCount,
								totalNodesCountChange,
							};
						}
					} catch (refreshError) {
						console.warn(`DOM refresh failed for tab ${tabId}:`, refreshError);
					}
				}

				// Return result without refresh data
				return {
					...fillResult,
					tabId,
					newNodesCount: 0,
					totalNodesCountChange: 0,
				};
			},
			{
				timeout: 60000,
				throwOnTimeout: true,
			},
		);
	},
	{
		name: "fillElementTool",
		description: "Fill an input element with text using human-like typing",
		schema: z.object({
			tabId: z.string().describe("The ID of the tab containing the element"),
			backendNodeId: z
				.number()
				.describe("Backend node ID of the input element"),
			value: z.string().describe("Text to fill in the input"),
			clear: z
				.boolean()
				.optional()
				.describe("Clear existing text before typing (default: true)"),
			keystrokeDelay: z
				.number()
				.optional()
				.describe("Delay between keystrokes in ms (default: 18)"),
		}),
	},
);

// Select Option Tool
export const selectOptionTool = tool(
	async ({ tabId, backendNodeId, values, clear = true, timeout = 5000 }) => {
		return await PQueueManager.getInstance().add(
			async () => {
				const sessionTabService = SessionTabService.getInstance();
				const interactionService =
					sessionTabService.getInteractionService(tabId);
				if (!interactionService) {
					throw new Error(`Interaction service not found for tab ${tabId}`);
				}

				const options: SelectOptionOptions = {
					values,
					clear,
					timeout,
				};

				// Record timestamp before the operation
				sessionTabService.updateTabTimestamp(tabId);

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
						const domService = sessionTabService.getDomService(tabId);
						if (domService) {
							const { newNodesCount, totalNodesCountChange } =
								await domService.buildSimplifiedDOMTree();

							// Return combined result
							return {
								...selectResult,
								tabId,
								newNodesCount,
								totalNodesCountChange,
							};
						}
					} catch (refreshError) {
						console.warn(`DOM refresh failed for tab ${tabId}:`, refreshError);
					}
				}

				// Return result without refresh data
				return {
					...selectResult,
					tabId,
					newNodesCount: 0,
					totalNodesCountChange: 0,
				};
			},
			{
				timeout: 60000,
				throwOnTimeout: true,
			},
		);
	},
	{
		name: "selectOptionTool",
		description: "Select option(s) in a select element by value or text",
		schema: z.object({
			tabId: z.string().describe("The ID of the tab containing the element"),
			backendNodeId: z
				.number()
				.describe("Backend node ID of the select element"),
			values: z
				.union([z.string(), z.array(z.string())])
				.describe("Single value or array of values to select"),
			clear: z
				.boolean()
				.optional()
				.describe("Clear existing selections (default: true)"),
			timeout: z.number().optional().describe("Timeout in ms (default: 5000)"),
		}),
	},
);

// Hover Element Tool
export const hoverElementTool = tool(
	async ({ tabId, backendNodeId, timeout = 3000 }) => {
		return await PQueueManager.getInstance().add(
			async () => {
				const sessionTabService = SessionTabService.getInstance();
				const interactionService =
					sessionTabService.getInteractionService(tabId);
				if (!interactionService) {
					throw new Error(`Interaction service not found for tab ${tabId}`);
				}

				const options: HoverOptions = {
					timeout,
				};

				// Record timestamp before the operation
				sessionTabService.updateTabTimestamp(tabId);

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
						const domService = sessionTabService.getDomService(tabId);
						if (domService) {
							const { newNodesCount, totalNodesCountChange } =
								await domService.buildSimplifiedDOMTree();

							// Return combined result
							return {
								...hoverResult,
								tabId,
								newNodesCount,
								totalNodesCountChange,
							};
						}
					} catch (refreshError) {
						console.warn(`DOM refresh failed for tab ${tabId}:`, refreshError);
					}
				}

				// Return result without refresh data
				return {
					...hoverResult,
					tabId,
					newNodesCount: 0,
					totalNodesCountChange: 0,
				};
			},
			{
				timeout: 60000,
				throwOnTimeout: true,
			},
		);
	},
	{
		name: "hoverElementTool",
		description: "Hover over an element using its backend node ID",
		schema: z.object({
			tabId: z.string().describe("The ID of the tab containing the element"),
			backendNodeId: z
				.number()
				.describe("Backend node ID of the element to hover"),
			timeout: z.number().optional().describe("Timeout in ms (default: 3000)"),
		}),
	},
);

// Drag to Element Tool
export const dragToElementTool = tool(
	async ({ tabId, sourceBackendNodeId, target }) => {
		return await PQueueManager.getInstance().add(
			async () => {
				const sessionTabService = SessionTabService.getInstance();
				const interactionService =
					sessionTabService.getInteractionService(tabId);
				if (!interactionService) {
					throw new Error(`Interaction service not found for tab ${tabId}`);
				}

				const options: DragOptions = {
					target: target as Position | number,
				};

				// Record timestamp before the operation
				sessionTabService.updateTabTimestamp(tabId);

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
						const domService = sessionTabService.getDomService(tabId);
						if (domService) {
							const { newNodesCount, totalNodesCountChange } =
								await domService.buildSimplifiedDOMTree();

							// Return combined result
							return {
								...dragResult,
								tabId,
								newNodesCount,
								totalNodesCountChange,
							};
						}
					} catch (refreshError) {
						console.warn(`DOM refresh failed for tab ${tabId}:`, refreshError);
					}
				}

				// Return result without refresh data
				return {
					...dragResult,
					tabId,
					newNodesCount: 0,
					totalNodesCountChange: 0,
				};
			},
			{
				timeout: 60000,
				throwOnTimeout: true,
			},
		);
	},
	{
		name: "dragToElementTool",
		description: "Drag from one element to a target position or element",
		schema: z.object({
			tabId: z.string().describe("The ID of the tab containing the elements"),
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
				.describe(
					"Target position {x, y} or backend node ID of target element",
				),
		}),
	},
);

// Scroll Pages Tool
export const scrollPagesTool = tool(
	async ({
		tabId,
		direction = "down",
		pages = 1.0,
		scrollDelay = 300,
		smooth = true,
	}) => {
		return await PQueueManager.getInstance().add(
			async () => {
				const sessionTabService = SessionTabService.getInstance();
				const interactionService =
					sessionTabService.getInteractionService(tabId);
				if (!interactionService) {
					throw new Error(`Interaction service not found for tab ${tabId}`);
				}

				const options: ScrollOptions = {
					direction,
					pages,
					scrollDelay,
					smooth,
				};

				// Record timestamp before the operation
				sessionTabService.updateTabTimestamp(tabId);

				// Execute original scroll operation
				const scrollResult = await interactionService.scrollPages(options);

				// Add automatic DOM refresh
				if (scrollResult.success) {
					try {
						// Wait for DOM changes to settle
						await new Promise((resolve) => setTimeout(resolve, 400));

						// Get DOM service and refresh
						const domService = sessionTabService.getDomService(tabId);
						if (domService) {
							const { newNodesCount, totalNodesCountChange } =
								await domService.buildSimplifiedDOMTree();

							// Return combined result
							return {
								...scrollResult,
								tabId,
								newNodesCount,
								totalNodesCountChange,
							};
						}
					} catch (refreshError) {
						console.warn(`DOM refresh failed for tab ${tabId}:`, refreshError);
					}
				}

				// Return result without refresh data
				return {
					...scrollResult,
					tabId,
					newNodesCount: 0,
					totalNodesCountChange: 0,
				};
			},
			{
				timeout: 60000,
				throwOnTimeout: true,
			},
		);
	},
	{
		name: "scrollPagesTool",
		description: "Scroll the page by number of pages",
		schema: z.object({
			tabId: z.string().describe("The ID of the tab to scroll"),
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
	},
);

// Scroll at Coordinate Tool
export const scrollAtCoordinateTool = tool(
	async ({ tabId, x, y, deltaX = 0, deltaY = 0 }) => {
		return await PQueueManager.getInstance().add(
			async () => {
				const sessionTabService = SessionTabService.getInstance();
				const interactionService =
					sessionTabService.getInteractionService(tabId);
				if (!interactionService) {
					throw new Error(`Interaction service not found for tab ${tabId}`);
				}

				const options: ScrollAtCoordinateOptions = {
					x,
					y,
					deltaX,
					deltaY,
				};

				// Record timestamp before the operation
				sessionTabService.updateTabTimestamp(tabId);

				// Execute original scroll operation
				const scrollResult =
					await interactionService.scrollAtCoordinate(options);

				// Add automatic DOM refresh
				if (scrollResult.success) {
					try {
						// Wait for DOM changes to settle
						await new Promise((resolve) => setTimeout(resolve, 400));

						// Get DOM service and refresh
						const domService = sessionTabService.getDomService(tabId);
						if (domService) {
							const { newNodesCount, totalNodesCountChange } =
								await domService.buildSimplifiedDOMTree();

							// Return combined result
							return {
								...scrollResult,
								tabId,
								newNodesCount,
								totalNodesCountChange,
							};
						}
					} catch (refreshError) {
						console.warn(`DOM refresh failed for tab ${tabId}:`, refreshError);
					}
				}

				// Return result without refresh data
				return {
					...scrollResult,
					tabId,
					newNodesCount: 0,
					totalNodesCountChange: 0,
				};
			},
			{
				timeout: 60000,
				throwOnTimeout: true,
			},
		);
	},
	{
		name: "scrollAtCoordinateTool",
		description: "Scroll at specific coordinates with delta values",
		schema: z.object({
			tabId: z.string().describe("The ID of the tab to scroll"),
			x: z.number().describe("X coordinate relative to viewport"),
			y: z.number().describe("Y coordinate relative to viewport"),
			deltaX: z
				.number()
				.optional()
				.describe("Horizontal scroll delta (default: 0)"),
			deltaY: z
				.number()
				.optional()
				.describe("Vertical scroll delta (default: 0)"),
		}),
	},
);

// Get Attribute Tool
export const getAttributeTool = tool(
	async ({ tabId, backendNodeId, attributeName }) => {
		return await PQueueManager.getInstance().add(
			async () => {
				const sessionTabService = SessionTabService.getInstance();
				const interactionService =
					sessionTabService.getInteractionService(tabId);
				if (!interactionService) {
					throw new Error(`Interaction service not found for tab ${tabId}`);
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
	{
		name: "getAttributeTool",
		description: "Get an attribute value from an element",
		schema: z.object({
			tabId: z.string().describe("The ID of the tab containing the element"),
			backendNodeId: z.number().describe("Backend node ID of the element"),
			attributeName: z.string().describe("Name of the attribute to retrieve"),
		}),
	},
);

// Evaluate Tool
export const evaluateTool = tool(
	async ({ tabId, backendNodeId, expression, args = [] }) => {
		return await PQueueManager.getInstance().add(
			async () => {
				const sessionTabService = SessionTabService.getInstance();
				const interactionService =
					sessionTabService.getInteractionService(tabId);
				if (!interactionService) {
					throw new Error(`Interaction service not found for tab ${tabId}`);
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
	{
		name: "evaluateTool",
		description: "Evaluate JavaScript expression on an element",
		schema: z.object({
			tabId: z.string().describe("The ID of the tab containing the element"),
			backendNodeId: z.number().describe("Backend node ID of the element"),
			expression: z
				.string()
				.describe(
					"JavaScript expression in arrow function format: (args) => { ... }",
				),
			args: z
				.array(z.any())
				.optional()
				.describe("Arguments to pass to the function (default: [])"),
		}),
	},
);

// Get Basic Info Tool
export const getBasicInfoTool = tool(
	async ({ tabId, backendNodeId }) => {
		return await PQueueManager.getInstance().add(
			async () => {
				const sessionTabService = SessionTabService.getInstance();
				const interactionService =
					sessionTabService.getInteractionService(tabId);
				if (!interactionService) {
					throw new Error(`Interaction service not found for tab ${tabId}`);
				}

				return await interactionService.getBasicInfo(backendNodeId);
			},
			{
				timeout: 60000,
				throwOnTimeout: true,
			},
		);
	},
	{
		name: "getBasicInfoTool",
		description: "Get comprehensive information about an element",
		schema: z.object({
			tabId: z.string().describe("The ID of the tab containing the element"),
			backendNodeId: z.number().describe("Backend node ID of the element"),
		}),
	},
);

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

// Type definitions for tool results with refresh support
export type ClickElementToolResult = ClickResult & {
	tabId: string;
	newNodesCount?: number;
	totalNodesCountChange?: number;
};

export type FillElementToolResult = FillResult & {
	tabId: string;
	newNodesCount?: number;
	totalNodesCountChange?: number;
};

export type SelectOptionToolResult = SelectOptionResult & {
	tabId: string;
	newNodesCount?: number;
	totalNodesCountChange?: number;
};

export type HoverElementToolResult = HoverResult & {
	tabId: string;
	newNodesCount?: number;
	totalNodesCountChange?: number;
};

export type DragToElementToolResult = DragResult & {
	tabId: string;
	newNodesCount?: number;
	totalNodesCountChange?: number;
};

export type ScrollPagesToolResult = ScrollResult & {
	tabId: string;
	newNodesCount?: number;
	totalNodesCountChange?: number;
};

export type ScrollAtCoordinateToolResult = ScrollResult & {
	tabId: string;
	newNodesCount?: number;
	totalNodesCountChange?: number;
};

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
