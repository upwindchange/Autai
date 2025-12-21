/**
 * Click interaction type definitions for Autai-Core DOM Service
 * Based on browser-use implementation patterns
 */

export type MouseButton = "left" | "right" | "middle";
export type ModifierType = "Alt" | "Control" | "Meta" | "Shift";

export interface ClickOptions {
	/**
	 * Mouse button to use (default: 'left')
	 */
	button?: MouseButton;

	/**
	 * Number of times to click (default: 1)
	 */
	clickCount?: number;

	/**
	 * Modifier keys to hold during click
	 */
	modifiers?: ModifierType[];

	/**
	 * Maximum time to wait for click completion in milliseconds (default: 5000)
	 */
	timeout?: number;
}

export interface BoundingBox {
	/**
	 * X coordinate of the top-left corner
	 */
	x: number;

	/**
	 * Y coordinate of the top-left corner
	 */
	y: number;

	/**
	 * Width of the element
	 */
	width: number;

	/**
	 * Height of the element
	 */
	height: number;
}

export interface Position {
	/**
	 * X coordinate
	 */
	x: number;

	/**
	 * Y coordinate
	 */
	y: number;
}

export interface ElementPosition {
	/**
	 * Backend node ID from CDP
	 */
	backendNodeId: number;

	/**
	 * Current bounding box (if available)
	 */
	boundingBox: BoundingBox | null;

	/**
	 * Content quads for complex shapes
	 */
	contentQuads: number[][];

	/**
	 * Timestamp when position was last updated
	 */
	lastUpdated: number;
}

export interface ClickResult {
	/**
	 * Whether the click was successful
	 */
	success: boolean;

	/**
	 * Error message if click failed
	 */
	error?: string;

	/**
	 * Final coordinates used for clicking
	 */
	coordinates?: Position;

	/**
	 * Which method was used for coordinate resolution
	 */
	method?: "contentQuads" | "boxModel" | "boundingRect" | "javascript";

	/**
	 * Time taken for the entire click operation in milliseconds
	 */
	duration?: number;
}

export interface FillOptions {
	/**
	 * Text value to input
	 */
	value: string;

	/**
	 * Whether to clear existing text before typing (default: true)
	 */
	clear?: boolean;

	/**
	 * Delay between keystrokes in milliseconds (default: 18)
	 */
	keystrokeDelay?: number;

	/**
	 * Maximum time to wait for fill completion in milliseconds (default: 10000)
	 */
	timeout?: number;
}

export interface FillResult {
	/**
	 * Whether the fill operation was successful
	 */
	success: boolean;

	/**
	 * Error message if fill failed
	 */
	error?: string;

	/**
	 * Number of characters that were typed
	 */
	charactersTyped?: number;

	/**
	 * Which method was used for the final typing operation
	 */
	method?: "cdp" | "javascript";

	/**
	 * Time taken for the entire fill operation in milliseconds
	 */
	duration?: number;
}

export interface ViewportInfo {
	/**
	 * Viewport width in pixels
	 */
	width: number;

	/**
	 * Viewport height in pixels
	 */
	height: number;

	/**
	 * Scroll position X
	 */
	scrollX: number;

	/**
	 * Scroll position Y
	 */
	scrollY: number;
}

export interface SelectOptionOptions {
	/**
	 * Single value or array of values to select
	 */
	values: string | string[];

	/**
	 * Whether to clear existing selections before selecting (default: true)
	 */
	clear?: boolean;

	/**
	 * Maximum time to wait for selection completion in milliseconds (default: 5000)
	 */
	timeout?: number;
}

export interface SelectOptionResult {
	/**
	 * Whether the selection was successful
	 */
	success: boolean;

	/**
	 * Error message if selection failed
	 */
	error?: string;

	/**
	 * Number of options that were successfully selected
	 */
	optionsSelected?: number;

	/**
	 * Array of option values that were matched and selected
	 */
	matchedValues?: string[];

	/**
	 * Which method was used for the selection
	 */
	method?: "cdp" | "javascript";

	/**
	 * Time taken for the entire selection operation in milliseconds
	 */
	duration?: number;
}

export interface HoverOptions {
	/**
	 * Maximum time to wait for hover completion in milliseconds (default: 3000)
	 */
	timeout?: number;
}

export interface HoverResult {
	/**
	 * Whether the hover was successful
	 */
	success: boolean;

	/**
	 * Error message if hover failed
	 */
	error?: string;

	/**
	 * Final coordinates used for hovering
	 */
	coordinates?: Position;

	/**
	 * Which method was used for coordinate resolution
	 */
	method?: "contentQuads" | "boxModel" | "boundingRect" | "javascript";

	/**
	 * Time taken for the entire hover operation in milliseconds
	 */
	duration?: number;
}

export interface OptionElement {
	/**
	 * Backend node ID of the option element
	 */
	backendNodeId: number;

	/**
	 * Option value attribute
	 */
	value: string;

	/**
	 * Option text content
	 */
	text: string;

	/**
	 * Whether the option is currently selected
	 */
	selected: boolean;

	/**
	 * Whether the option is disabled
	 */
	disabled: boolean;
}

export interface DragOptions {
	/**
	 * Target can be a Position {x, y} or an Element backendNodeId
	 * - If Position: drag to exact coordinates
	 * - If number: drag to center of element with that backendNodeId
	 */
	target: Position | number;
}

export interface DragResult {
	/**
	 * Whether the drag operation was successful
	 */
	success: boolean;

	/**
	 * Error message if drag failed
	 */
	error?: string;

	/**
	 * Source coordinates where drag started
	 */
	sourceCoordinates?: Position;

	/**
	 * Target coordinates where drag ended
	 */
	targetCoordinates?: Position;

	/**
	 * Method used for coordinate resolution
	 */
	method?: "contentQuads" | "boxModel" | "boundingRect" | "javascript";

	/**
	 * Time taken for the entire drag operation in milliseconds
	 */
	duration?: number;
}

// get_attribute interfaces
export interface GetAttributeOptions {
	/**
	 * Name of the attribute to retrieve
	 */
	attributeName: string;
}

export interface GetAttributeResult {
	/**
	 * Whether the attribute retrieval was successful
	 */
	success: boolean;

	/**
	 * Attribute value if found (null if attribute doesn't exist)
	 */
	value?: string | null;

	/**
	 * Error message if attribute retrieval failed
	 */
	error?: string;

	/**
	 * Whether the attribute exists on the element
	 */
	exists?: boolean;

	/**
	 * Time taken for the attribute retrieval operation in milliseconds
	 */
	duration?: number;
}

// evaluate interfaces
export interface EvaluateOptions {
	/**
	 * JavaScript expression to execute (must be in arrow function format)
	 */
	expression: string;

	/**
	 * Arguments to pass to the JavaScript function
	 */
	arguments?: unknown[];

	/**
	 * Maximum time to wait for evaluation completion in milliseconds (default: 10000)
	 */
	timeout?: number;
}

export interface EvaluateResult {
	/**
	 * Whether the evaluation was successful
	 */
	success: boolean;

	/**
	 * Result of the JavaScript evaluation
	 */
	result?: unknown;

	/**
	 * Error message if evaluation failed
	 */
	error?: string;

	/**
	 * Type of the result
	 */
	type?: string;

	/**
	 * Whether the evaluation threw an exception
	 */
	wasThrown?: boolean;

	/**
	 * Time taken for the evaluation operation in milliseconds
	 */
	duration?: number;
}

// get_basic_info interfaces
export interface ElementBasicInfo {
	/**
	 * Backend node ID from CDP
	 */
	backendNodeId: number;

	/**
	 * Node ID from CDP
	 */
	nodeId?: number;

	/**
	 * Node name (e.g., "DIV", "INPUT")
	 */
	nodeName: string;

	/**
	 * Node type (e.g., 1 for ELEMENT_NODE)
	 */
	nodeType: number;

	/**
	 * Node value
	 */
	nodeValue?: string | null;

	/**
	 * Element attributes as key-value pairs
	 */
	attributes: Record<string, string>;

	/**
	 * Element bounding box
	 */
	boundingBox?: BoundingBox;

	/**
	 * Error message if any part of the info collection failed
	 */
	error?: string | null;

	/**
	 * Tag name in lowercase (e.g., "div", "input")
	 */
	tagName?: string;

	/**
	 * Text content of the element (limited to 500 characters)
	 */
	textContent?: string;

	/**
	 * Whether the element is visible
	 */
	isVisible?: boolean;

	/**
	 * Whether the element is interactive (clickable, focusable, etc.)
	 */
	isInteractive?: boolean;

	/**
	 * Element ID attribute
	 */
	id?: string;

	/**
	 * Array of CSS class names
	 */
	classes?: string[];
}

export interface GetBasicInfoOptions {
	/**
	 * Optional configuration for basic info retrieval
	 */
	includeTextContent?: boolean;
	maxTextLength?: number;
}

export interface GetBasicInfoResult {
	/**
	 * Whether the basic info retrieval was successful
	 */
	success: boolean;

	/**
	 * Comprehensive element information if successful
	 */
	info?: ElementBasicInfo;

	/**
	 * Error message if basic info retrieval failed
	 */
	error?: string;

	/**
	 * Time taken for the basic info retrieval operation in milliseconds
	 */
	duration?: number;
}

// Scroll interfaces
export interface ScrollOptions {
	/**
	 * Scroll direction - down for positive, up for negative
	 */
	direction?: "up" | "down";

	/**
	 * Number of pages to scroll (supports fractional values like 0.5 for half page)
	 */
	pages?: number;

	/**
	 * Milliseconds to wait between scroll operations
	 */
	scrollDelay?: number;

	/**
	 * Whether to scroll smoothly (if supported)
	 */
	smooth?: boolean;
}

export interface ScrollAtCoordinateOptions {
	/**
	 * X coordinate relative to viewport left edge
	 */
	x: number;

	/**
	 * Y coordinate relative to viewport top edge
	 */
	y: number;

	/**
	 * Horizontal scroll delta (positive=right, negative=left)
	 */
	deltaX?: number;

	/**
	 * Vertical scroll delta (positive=down, negative=up)
	 */
	deltaY?: number;
}

export interface ScrollResult {
	/**
	 * Whether the scroll operation succeeded
	 */
	success: boolean;

	/**
	 * New scroll position if successful
	 */
	scrollPosition?: Position;

	/**
	 * Total pixels scrolled
	 */
	pixelsScrolled?: number;

	/**
	 * Scroll direction used
	 */
	direction?: string;

	/**
	 * Method used for scrolling ('cdp', 'javascript', 'element')
	 */
	method?: string;

	/**
	 * Execution time in milliseconds
	 */
	duration?: number;

	/**
	 * Error message if failed
	 */
	error?: string;
}

// Interactive tool result interfaces with DOM refresh support
export interface InteractiveToolResult {
	/**
	 * Whether the operation was successful
	 */
	success: boolean;

	/**
	 * Error message if operation failed
	 */
	error?: string;

	/**
	 * View ID for which the operation was performed
	 */
	viewId: string;

	/**
	 * Number of new DOM nodes detected after refresh
	 */
	newNodesCount?: number;

	/**
	 * Total change in DOM node count after refresh
	 */
	totalNodesCountChange?: number;
}

// Extended result types for interactive tools with refresh data
export interface ClickElementToolResult
	extends ClickResult, InteractiveToolResult {}
export interface FillElementToolResult
	extends FillResult, InteractiveToolResult {}
export interface SelectOptionToolResult
	extends SelectOptionResult, InteractiveToolResult {}
export interface HoverElementToolResult
	extends HoverResult, InteractiveToolResult {}
export interface DragToElementToolResult
	extends DragResult, InteractiveToolResult {}
export interface ScrollPagesToolResult
	extends ScrollResult, InteractiveToolResult {}
export interface ScrollAtCoordinateToolResult
	extends ScrollResult, InteractiveToolResult {}
