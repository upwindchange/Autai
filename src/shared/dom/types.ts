/**
 * Core DOM types for CDP infrastructure
 */

export interface DOMRect {
  x: number;
  y: number;
  width: number;
  height: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  area: number;

  /**
   * Convert to dictionary format
   */
  toDict(): Record<string, number>;
}


// ===== PHASE 2: Enhanced DOM Analysis Types =====

/**
 * Enhanced snapshot node from DOMSnapshot data
 */
export interface EnhancedSnapshotNode {
  isClickable?: boolean;
  cursorStyle?: string;
  bounds?: DOMRect | null;
  clientRects?: DOMRect | null;
  scrollRects?: DOMRect | null;
  computedStyles?: Record<string, string> | null;
  paintOrder?: number;
  stackingContexts?: number;
}

/**
 * Enhanced accessibility node
 */
export interface EnhancedAXNode {
  axNodeId: string;
  ignored: boolean;
  role?: string | null;
  name?: string | null;
  description?: string | null;
  properties?: EnhancedAXProperty[] | null;
  childIds?: string[] | null;
}

/**
 * Enhanced accessibility property
 */
export interface EnhancedAXProperty {
  name: string;
  value: string | boolean | null;
}

/**
 * Node types from DOM specification
 */
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

/**
 * Enhanced DOM tree node integrating CDP data
 */
export interface EnhancedDOMTreeNode {
  // Basic DOM properties
  nodeId: number;
  backendNodeId: number;
  nodeType: NodeType;
  nodeName: string;
  nodeValue: string;
  attributes: Record<string, string>;

  // Layout and visibility
  isScrollable?: boolean | null;
  isVisible?: boolean | null;
  absolutePosition?: DOMRect | null;

  // Frame information
  targetId: string;
  frameId?: string | null;
  sessionId?: string | null;
  contentDocument?: EnhancedDOMTreeNode | null;

  // Shadow DOM
  shadowRootType?: string | null;
  shadowRoots?: EnhancedDOMTreeNode[] | null;

  // Navigation
  parentNode?: EnhancedDOMTreeNode | null;
  childrenNodes?: EnhancedDOMTreeNode[] | null;

  // Accessibility data
  axNode?: EnhancedAXNode | null;

  // Snapshot data
  snapshotNode?: EnhancedSnapshotNode | null;

  // Interactive element index
  elementIndex?: number | null;

  // Compound control information
  _compoundChildren?: Record<string, unknown>[];

  // UUID for identification
  uuid?: string;

  // Helper properties
  tag?: string; // Lowercase tag name
  xpath?: string; // Generated XPath

  // Methods
  get children(): EnhancedDOMTreeNode[];
  get childrenAndShadowRoots(): EnhancedDOMTreeNode[];
  get parent(): EnhancedDOMTreeNode | null;
  get isActuallyScrollable(): boolean;
  get shouldShowScrollInfo(): boolean;
  get scrollInfo(): Record<string, unknown> | null;
  get elementHash(): number;
}

/**
 * Target information from CDP
 */
interface TargetInfo {
  targetId: string;
  type: string;
  title: string;
  url: string;
  attached: boolean;
}

/**
 * Target information for current page
 */
export interface CurrentPageTargets {
  pageSession: TargetInfo;
  iframeSessions: TargetInfo[];
}

/**
 * DOM document structure from CDP
 */
interface DOMDocument {
  root: {
    nodeId: number;
    backendNodeId: number;
    nodeType: number;
    nodeName: string;
    nodeValue: string;
    attributes?: string[];
    children?: DOMDocument[];
    shadowRoots?: DOMDocument[];
    contentDocument?: DOMDocument;
    frameId?: string;
    isScrollable?: boolean;
    shadowRootType?: string;
  };
}

/**
 * Accessibility node from CDP
 */
interface AXNode {
  nodeId: string;
  backendDOMNodeId?: number;
  ignored: boolean;
  role?: { value: string };
  name?: { value: string };
  description?: { value: string };
  properties?: Array<{
    name: string;
    value: { value?: string | boolean };
  }>;
  childIds?: string[];
}

/**
 * Complete tree data for a target
 */
export interface TargetAllTrees {
  snapshot: DOMSnapshot;
  domTree: DOMDocument;
  axTree: { nodes: AXNode[] };
  devicePixelRatio: number;
  cdpTiming: Record<string, number>;
}

/**
 * Viewport information
 */
export interface ViewportInfo {
  width: number;
  height: number;
  devicePixelRatio: number;
  scrollX: number;
  scrollY: number;
}


/**
 * DOM snapshot return data structure
 */
export interface DOMSnapshot {
  documents: {
    nodeTree: {
      backendNodeId?: number[];
      isClickable?: { index: number[] };
    };
    layout: {
      nodeIndex?: number[];
      bounds?: number[][];
      styles?: number[][];
      paintOrders?: number[];
      clientRects?: number[][];
      scrollRects?: number[][];
      stackingContexts?: { index: number[] };
    };
    frameId?: string;
    url?: string;
  }[];
  strings: string[];
}

/**
 * Accessibility tree structure
 */
export interface AXTree {
  nodes: EnhancedAXNode[];
}

/**
 * Propagating bounds information for bounding box filtering
 */
export interface PropagatingBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  node: SimplifiedNode;
}

/**
 * DOM selector map for element mapping and interaction
 */
export type DOMSelectorMap = Record<number, EnhancedDOMTreeNode>;

/**
 * Compound component virtual element
 */
export interface CompoundComponent {
  role: 'spinbutton' | 'slider' | 'button' | 'textbox' | 'listbox' | 'combobox';
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

/**
 * Serialization configuration options
 */
export interface SerializationConfig {
  enablePaintOrderFiltering: boolean;
  enableBoundingBoxFiltering: boolean;
  enableCompoundComponents: boolean;
  opacityThreshold: number;
  containmentThreshold: number;
  maxInteractiveElements: number;
}

/**
 * Serialization timing information
 */
export interface SerializationTiming {
  total: number;
  createSimplifiedTree: number;
  paintOrderFiltering: number;
  optimizeTreeStructure: number;
  boundingBoxFiltering: number;
  assignInteractiveIndices: number;
  markNewElements: number;
}

/**
 * Serialization statistics
 */
export interface SerializationStats {
  totalNodes: number;
  simplifiedNodes: number;
  filteredNodes: number;
  interactiveElements: number;
  newElements: number;
  occludedNodes: number;
  containedNodes: number;
  compoundComponents: number;
}

/**
 * Serialized DOM state for LLM consumption
 */
export interface SerializedDOMState {
  root: SimplifiedNode;
  selectorMap: DOMSelectorMap;
  timing?: SerializationTiming;
  stats?: SerializationStats;
  config?: SerializationConfig;

  /**
   * Generate LLM-friendly representation of the DOM
   */
  llm_representation?(): string;
}

/**
 * Simplified node for serialization
 */
export interface SimplifiedNode {
  originalNode: EnhancedDOMTreeNode;
  children: SimplifiedNode[];
  shouldDisplay: boolean;
  interactiveIndex: number | null;
  isNew: boolean;
  ignoredByPaintOrder: boolean;
  excludedByParent: boolean;
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
  xpath: string;
  tagName: string;
  textContent: string;
}

/**
 * Interactive element detection result
 */
export interface InteractiveDetectionResult {
  isInteractive: boolean;
  score: number;
  detectionLayers: string[];
}

/**
 * Paint order filtering statistics
 */
export interface PaintOrderStats {
  totalNodes: number;
  visibleNodes: number;
  occludedNodes: number;
  filterRate: number;
  unionRectCount: number;
}

/**
 * Bounding box filtering statistics
 */
export interface BoundingBoxFilterStats {
  totalNodes: number;
  excludedNodes: number;
  propagatingNodes: number;
  interactiveExceptions: number;
  sizeFiltered: number;
}


/**
 * Element pattern for matching
 */
export interface ElementPattern {
  tag: string;
  role?: string;
  hasAttribute?: string;
  className?: string;
  idPattern?: string;
}

/**
 * Performance metrics for serialization
 */
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
