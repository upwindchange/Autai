/**
 * DOM types using official devtools-protocol definitions
 */

import type { Protocol as CDP } from "devtools-protocol";

// Node types from DOM specification
export enum NodeType {
	ELEMENT_NODE = 1,
	ATTRIBUTE_NODE = 2,
	TEXT_NODE = 3,
	CDATA_SECTION_NODE = 4,
	ENTITY_REFERENCE_NODE = 5,
	ENTITY_NODE = 6,
	PROCESSING_INSTRUCTION_NODE = 7,
	COMMENT_NODE = 8,
	DOCUMENT_NODE = 9,
	DOCUMENT_TYPE_NODE = 10,
	DOCUMENT_FRAGMENT_NODE = 11,
	NOTATION_NODE = 12,
}

// Complete tree data for a target using official types
export interface TargetAllTrees {
	snapshot: CDP.DOMSnapshot.CaptureSnapshotResponse | null;
	domTree: CDP.DOM.GetDocumentResponse | null;
	axTree: CDP.Accessibility.GetFullAXTreeResponse;
	devicePixelRatio: number;
	cdpTiming: Record<string, number>;
}

export interface ViewportInfo {
	width: number;
	height: number;
	devicePixelRatio: number;
	scrollX: number;
	scrollY: number;
}

interface TargetInfo {
	targetId: string;
	type: string;
	title: string;
	url: string;
	attached: boolean;
}

export interface CurrentPageTargets {
	pageSession: TargetInfo;
	iframeSessions: TargetInfo[];
}

// Enhanced snapshot node - extends official DOMSnapshot.DOMNode with additional properties
export interface EnhancedSnapshotNode extends Partial<CDP.DOMSnapshot.LayoutTreeNode> {
	isClickable?: boolean;
	cursorStyle?: string;
	bounds?: CDP.DOM.Rect | null;
	clientRects?: CDP.DOM.Rect | null;
	scrollRects?: CDP.DOM.Rect | null;
	computedStyles?: Record<string, string> | null;
	paintOrder?: number;
	stackingContexts?: number;
}

// Enhanced DOM tree node - extends official DOM.Node with app-specific properties
export interface EnhancedDOMTreeNode extends Omit<
	CDP.DOM.Node,
	| "children"
	| "attributes"
	| "frameId"
	| "shadowRootType"
	| "contentDocument"
	| "shadowRoots"
	| "backendNodeId"
> {
	// Override children with enhanced type
	children?: EnhancedDOMTreeNode[];

	// Override attributes with computed object instead of string array
	attributes: Record<string, string>;

	// Additional computed properties not in official CDP
	isScrollable?: boolean;
	isVisible?: boolean;
	absolutePosition: CDP.DOM.Rect | null;

	// Frame information (custom for app logic)
	targetId: string;
	frameId?: string | null;
	sessionId?: string | null;
	contentDocument?: EnhancedDOMTreeNode | null;

	// Shadow DOM (using official types)
	shadowRootType?: CDP.DOM.ShadowRootType | null;
	shadowRoots?: EnhancedDOMTreeNode[] | null;

	// Navigation (custom for app logic)
	parentNode: EnhancedDOMTreeNode | null;
	childrenNodes?: EnhancedDOMTreeNode[] | null;

	// Accessibility data (using official CDP interface)
	axNode: CDP.Accessibility.AXNode | null;

	// Snapshot data (using enhanced interface for app logic)
	snapshotNode?: EnhancedSnapshotNode | null;

	// Interactive element index (custom for app logic)
	elementIndex?: number | null;

	// Compound control information (custom for app logic)
	_compoundChildren?: Record<string, unknown>[];

	// UUID for identification (custom for app logic)
	uuid?: string;

	// Backend node ID from Chrome DevTools Protocol for stable identification
	backendNodeId?: number;

	// Helper properties (custom for app logic)
	tag?: string;

	// Methods (custom for app logic)
	get actualChildren(): EnhancedDOMTreeNode[];
	get childrenAndShadowRoots(): EnhancedDOMTreeNode[];
	get parent(): EnhancedDOMTreeNode | null;
	get isActuallyScrollable(): boolean;
	get shouldShowScrollInfo(): boolean;
	get scrollInfo(): Record<string, unknown> | null;
	get elementHash(): number;
}

// Rest are ONLY custom for app logic - no official CDP equivalents
export interface PropagatingBounds {
	x: number;
	y: number;
	width: number;
	height: number;
	node: SimplifiedNode;
}

export type DOMSelectorMap = Record<number, EnhancedDOMTreeNode>;

export interface CompoundComponent {
	role: "spinbutton" | "slider" | "button" | "textbox" | "listbox" | "combobox";
	name: string;
	description?: string;
	valuemin?: number;
	valuemax?: number;
	valuenow?: number | null;
	options_count?: number;
	first_options?: string[];
	format_hint?: string;
	readonly?: boolean;
	formats?: string;
}

export interface SerializationConfig {
	enablePaintOrderFiltering: boolean;
	enableBoundingBoxFiltering: boolean;
	opacityThreshold: number;
	containmentThreshold: number;
	maxInteractiveElements: number;
	highlightInteractiveElements?: boolean;

	// Bounding box specific configuration
	boundingBoxConfig?: {
		minIconSize: number;
		maxIconSize: number;
		minIframeWidth: number;
		minIframeHeight: number;
		enableSizeFiltering: boolean;
		enablePropagationFiltering: boolean;
	};
}

export interface SerializationTiming {
	total: number;
	createSimplifiedTree: number;
	paintOrderFiltering: number;
	optimizeTreeStructure: number;
	boundingBoxFiltering: number;
	highlighting: number;
	assignInteractiveIndices: number;
	markNewElements: number;
}

export interface SerializationStats {
	timestamp: number;
	simplifiedNodesCount: number;
	simplifiedNodesCountChange: number;
	newSimplifiedNodesCount: number;
	interactiveElements: number;
	filteredNodes: number;
	occludedNodes: number;
	containedNodes: number;
	sizeFilteredNodes: number;
}

export interface SerializedDOMState {
	flattenedDOM: string;
	stats: SerializationStats;
	root: SimplifiedNode;
	selectorMap: DOMSelectorMap;
}

export interface SimplifiedNode {
	originalNode: EnhancedDOMTreeNode;
	children: SimplifiedNode[];
	shouldDisplay: boolean;
	interactiveIndex: number | null;
	isNew: boolean;
	ignoredByPaintOrder: boolean;
	excludedByParent: boolean;
	excludedByBoundingBox?: boolean;
	exclusionReason?: "size_filtered" | "contained" | string;
	isShadowHost: boolean;
	isCompoundComponent: boolean;

	// Additional properties for enhanced tracking
	hasCompoundChildren: boolean;
	isLeaf: boolean;
	depth: number;
	nodeHash: number;

	// Helper properties (required for object creation)
	interactiveElement: boolean;
	hasChildren: boolean;
	tagName: string;
	textContent: string;
}

export interface ScrollInfo {
	scrollWidth: number;
	clientWidth: number;
	scrollLeft: number;
	scrollHeight: number;
	clientHeight: number;
	scrollTop: number;
}

export interface BoundsObject {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface CDPProperty {
	type: string;
	value: unknown;
}

export interface InteractiveDetectionResult {
	isInteractive: boolean;
	score: number;
	detectionLayers: string[];
}

export interface PaintOrderStats {
	totalNodes: number;
	visibleNodes: number;
	occludedNodes: number;
	filterRate: number;
	unionRectCount: number;
}

export interface BoundingBoxFilterStats {
	totalNodes: number;
	excludedNodes: number;
	propagatingNodes: number;
	interactiveExceptions: number;
	sizeFiltered: number;
}

export interface ElementPattern {
	tag: string;
	role?: string;
	hasAttribute?: string;
	className?: string;
	idPattern?: string;
}

export interface SerializationMetrics {
	cdpTiming: Record<string, number>;
	serializationTiming: SerializationTiming;
	memoryUsage: {
		peak: number;
		current: number;
		freed: number;
	};
	efficiency: {
		tokenReduction: number;
		filteringEfficiency: number;
		cacheHitRate: number;
	};
}

export interface IncrementalDetectionResult {
	success: boolean;
	hasChanges: boolean;
	changeCount: number;
	newElementsCount: number;
	timestamp: number;
	error?: string;
}

export interface LLMRepresentationResult {
	success: boolean;
	representation: string;
	stats?: SerializationStats;
	timestamp: number;
	error?: string;
}
