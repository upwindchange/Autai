/**
 * DOM-related type definitions for browser automation and element interaction
 */

export interface ViewportInfo {
  width: number;
  height: number;
}

export interface DOMBaseNode {
  isVisible: boolean;
  parent: DOMElementNode | null;
}

export interface DOMTextNode extends DOMBaseNode {
  type: 'TEXT_NODE';
  text: string;
}

export interface DOMElementNode extends DOMBaseNode {
  type: 'ELEMENT_NODE';
  tagName: string;
  xpath: string;
  attributes: Record<string, string>;
  children: (DOMElementNode | DOMTextNode)[];
  isInteractive: boolean;
  isTopElement: boolean;
  isInViewport: boolean;
  highlightIndex?: number | null;
  shadowRoot: boolean;
  viewportInfo?: ViewportInfo | null;
}

export type DOMNode = DOMElementNode | DOMTextNode;

export interface SelectorMap {
  [highlightIndex: number]: DOMElementNode;
}

export interface DOMState {
  elementTree: DOMElementNode;
  selectorMap: SelectorMap;
}

export interface BuildDomTreeArgs {
  doHighlightElements: boolean;
  focusHighlightIndex: number;
  viewportExpansion: number;
  debugMode: boolean;
}

/**
 * Raw node data returned from JavaScript DOM analysis
 */
export interface JSNodeData {
  type?: string;
  text?: string;
  tagName?: string;
  xpath?: string;
  attributes?: Record<string, string>;
  isVisible?: boolean;
  isInteractive?: boolean;
  isTopElement?: boolean;
  isInViewport?: boolean;
  highlightIndex?: number | null;
  shadowRoot?: boolean;
  children?: string[];
  viewport?: {
    width: number;
    height: number;
  };
}

/**
 * Result from JavaScript DOM tree evaluation
 */
export interface JSEvalResult {
  map: Record<string, JSNodeData>;
  rootId: string;
  perfMetrics?: {
    nodeMetrics?: {
      totalNodes?: number;
      processedNodes?: number;
    };
  };
}

/**
 * Performance metrics for DOM analysis
 */
export interface DOMPerfMetrics {
  totalNodes: number;
  processedNodes: number;
  interactiveNodes: number;
  analysisTime: number;
}