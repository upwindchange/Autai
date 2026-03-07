import type {
	ClickToolResult,
	FillToolResult,
	SelectToolResult,
	HoverToolResult,
	DragToolResult,
	ScrollToolResult,
	GetAttributeToolResult,
	EvaluateToolResult,
	GetBasicInfoToolResult,
	DOMTreeResult,
	FlattenDOMResult,
	ListSessionsResult,
	GetSessionTabsResult,
	GetTabInfoResult,
	CreateTabResult,
	GetCurrentSessionContextResult,
} from "./types/results";

/**
 * Map of tool names to their result types
 */
export type ToolResultMap = {
	clickElement: ClickToolResult;
	fillElement: FillToolResult;
	selectOption: SelectToolResult;
	hoverElement: HoverToolResult;
	dragToElement: DragToolResult;
	scrollPages: ScrollToolResult;
	scrollAtCoordinate: ScrollToolResult;
	getAttribute: GetAttributeToolResult;
	evaluate: EvaluateToolResult;
	getBasicInfo: GetBasicInfoToolResult;
	getDOMTree: DOMTreeResult;
	getFlattenDOM: FlattenDOMResult;
	listSessions: ListSessionsResult;
	getSessionTabs: GetSessionTabsResult;
	getTabInfo: GetTabInfoResult;
	createTab: CreateTabResult;
	getCurrentSessionContext: GetCurrentSessionContextResult;
};

/**
 * Extract tool results from AI SDK steps with type safety
 *
 * @param steps - Steps from generateText or streamText result
 * @param toolName - Name of the tool to extract results for
 * @returns Array of typed tool results (empty if tool not found)
 *
 * @example
 * ```typescript
 * const { steps } = await generateText({ ... });
 * const clickResults = extractToolResults(steps, 'clickElement');
 *
 * for (const result of clickResults) {
 *   if (result.success) {
 *     console.log(result.tabId);          // ✅ Type-safe
 *     console.log(result.newNodesCount);  // ✅ Type-safe
 *   }
 * }
 * ```
 */
export function extractToolResults<K extends keyof ToolResultMap>(
	steps: Array<{ toolResults?: Array<{ toolName: string; output: unknown }> }>,
	toolName: K,
): Array<ToolResultMap[K]> {
	// Handle single step case
	if (steps.length === 1) {
		const step = steps[0];
		if (!step?.toolResults) return [];

		const results = step.toolResults
			.filter((r) => r.toolName === toolName)
			.map((r) => r.output as ToolResultMap[K]);

		return results;
	}

	// Handle multiple steps case - use flatMap
	return steps.flatMap((step) => {
		if (!step?.toolResults) return [];

		return step.toolResults
			.filter((r) => r.toolName === toolName)
			.map((r) => r.output as ToolResultMap[K]);
	});
}

/**
 * Extract the first tool result from steps
 *
 * @param steps - Steps from generateText or streamText result
 * @param toolName - Name of the tool to extract result for
 * @returns First matching tool result or undefined
 *
 * @example
 * ```typescript
 * const { steps } = await generateText({ ... });
 * const clickResult = extractFirstToolResult(steps, 'clickElement');
 *
 * if (clickResult?.success) {
 *   console.log(clickResult.tabId);  // ✅ Type-safe
 * }
 * ```
 */
export function extractFirstToolResult<K extends keyof ToolResultMap>(
	steps: Array<{ toolResults?: Array<{ toolName: string; output: unknown }> }>,
	toolName: K,
): ToolResultMap[K] | undefined {
	const results = extractToolResults(steps, toolName);
	return results[0];
}

/**
 * Get all tool results grouped by tool name
 *
 * @param steps - Steps from generateText or streamText result
 * @returns Object with tool names as keys and arrays of results as values
 *
 * @example
 * ```typescript
 * const { steps } = await generateText({ ... });
 * const allResults = groupToolResults(steps);
 *
 * // Access all click results
 * for (const clickResult of allResults.clickElement) {
 *   if (clickResult.success) {
 *     console.log(clickResult.tabId);
 *   }
 * }
 * ```
 */
export function groupToolResults(
	steps: Array<{ toolResults?: Array<{ toolName: string; output: unknown }> }>,
): {
	[K in keyof ToolResultMap]: Array<ToolResultMap[K]>;
} {
	const grouped = {
		clickElement: [] as ClickToolResult[],
		fillElement: [] as FillToolResult[],
		selectOption: [] as SelectToolResult[],
		hoverElement: [] as HoverToolResult[],
		dragToElement: [] as DragToolResult[],
		scrollPages: [] as ScrollToolResult[],
		scrollAtCoordinate: [] as ScrollToolResult[],
		getAttribute: [] as GetAttributeToolResult[],
		evaluate: [] as EvaluateToolResult[],
		getBasicInfo: [] as GetBasicInfoToolResult[],
		getDOMTree: [] as DOMTreeResult[],
		getFlattenDOM: [] as FlattenDOMResult[],
		listSessions: [] as ListSessionsResult[],
		getSessionTabs: [] as GetSessionTabsResult[],
		getTabInfo: [] as GetTabInfoResult[],
		createTab: [] as CreateTabResult[],
		getCurrentSessionContext: [] as GetCurrentSessionContextResult[],
	};

	// Extract all tool results
	for (const step of steps) {
		if (!step?.toolResults) continue;

		for (const toolResult of step.toolResults) {
			const key = toolResult.toolName as keyof ToolResultMap;

			switch (key) {
				case "clickElement":
					grouped.clickElement.push(toolResult.output as ClickToolResult);
					break;
				case "fillElement":
					grouped.fillElement.push(toolResult.output as FillToolResult);
					break;
				case "selectOption":
					grouped.selectOption.push(toolResult.output as SelectToolResult);
					break;
				case "hoverElement":
					grouped.hoverElement.push(toolResult.output as HoverToolResult);
					break;
				case "dragToElement":
					grouped.dragToElement.push(toolResult.output as DragToolResult);
					break;
				case "scrollPages":
					grouped.scrollPages.push(toolResult.output as ScrollToolResult);
					break;
				case "scrollAtCoordinate":
					grouped.scrollAtCoordinate.push(toolResult.output as ScrollToolResult);
					break;
				case "getAttribute":
					grouped.getAttribute.push(toolResult.output as GetAttributeToolResult);
					break;
				case "evaluate":
					grouped.evaluate.push(toolResult.output as EvaluateToolResult);
					break;
				case "getBasicInfo":
					grouped.getBasicInfo.push(toolResult.output as GetBasicInfoToolResult);
					break;
				case "getDOMTree":
					grouped.getDOMTree.push(toolResult.output as DOMTreeResult);
					break;
				case "getFlattenDOM":
					grouped.getFlattenDOM.push(toolResult.output as FlattenDOMResult);
					break;
				case "listSessions":
					grouped.listSessions.push(toolResult.output as ListSessionsResult);
					break;
				case "getSessionTabs":
					grouped.getSessionTabs.push(toolResult.output as GetSessionTabsResult);
					break;
				case "getTabInfo":
					grouped.getTabInfo.push(toolResult.output as GetTabInfoResult);
					break;
				case "createTab":
					grouped.createTab.push(toolResult.output as CreateTabResult);
					break;
				case "getCurrentSessionContext":
					grouped.getCurrentSessionContext.push(
						toolResult.output as GetCurrentSessionContextResult,
					);
					break;
			}
		}
	}

	return grouped;
}
