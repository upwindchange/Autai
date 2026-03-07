/**
 * AI SDK Browser Automation Tools
 *
 * Migrated from Langchain patterns to AI SDK patterns
 * Uses experimental_context for zero-token context passing
 */

// Export tool collections as objects
export { interactiveTools } from "./InteractiveTools";
export { domTools } from "./DOMTools";
export { sessionTools } from "./SessionTabTools";
export { navigationTools } from "./TabControlTools";

// Export utility functions for type-safe result extraction
export {
	extractToolResults,
	extractFirstToolResult,
	groupToolResults,
} from "./utils";
export type { ToolResultMap } from "./utils";

// Export all types
export type {
	ToolExecutionContext,
	ToolContextOptions,
} from "./types/context";

export type {
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

// All tools as single object for AI SDK
import { interactiveTools } from "./InteractiveTools";
import { domTools } from "./DOMTools";
import { sessionTools } from "./SessionTabTools";
import { navigationTools } from "./TabControlTools";

export const allBrowserTools = {
	...interactiveTools,
	...domTools,
	...sessionTools,
	...navigationTools,
};

// Tool names enum for type safety
export const AI_TOOL_NAMES = {
	// Interactive
	CLICK_ELEMENT: "clickElement",
	FILL_ELEMENT: "fillElement",
	SELECT_OPTION: "selectOption",
	HOVER_ELEMENT: "hoverElement",
	DRAG_TO_ELEMENT: "dragToElement",
	SCROLL_PAGES: "scrollPages",
	SCROLL_AT_COORDINATE: "scrollAtCoordinate",
	GET_ATTRIBUTE: "getAttribute",
	EVALUATE: "evaluate",
	GET_BASIC_INFO: "getBasicInfo",

	// DOM
	GET_DOM_TREE: "getDOMTree",
	GET_FLATTEN_DOM: "getFlattenDOM",

	// Session
	LIST_SESSIONS: "listSessions",
	GET_SESSION_TABS: "getSessionTabs",
	GET_TAB_INFO: "getTabInfo",
	CREATE_TAB: "createTab",
	GET_CURRENT_SESSION_CONTEXT: "getCurrentSessionContext",

	// Navigation
	NAVIGATE: "navigate",
	REFRESH: "refresh",
	GO_BACK: "goBack",
	GO_FORWARD: "goForward",
} as const;

export type AIToolName = (typeof AI_TOOL_NAMES)[keyof typeof AI_TOOL_NAMES];
