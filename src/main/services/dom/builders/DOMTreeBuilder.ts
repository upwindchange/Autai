/**
 * DOM Tree Builder - Constructs enhanced DOM trees from CDP data
 *
 * Integrates DOM, accessibility, and snapshot data to create comprehensive
 * DOM tree representations with enhanced element information.
 */

import type {
  EnhancedDOMTreeNode,
  EnhancedAXNode,
  EnhancedAXProperty,
  DOMRect,
  TargetAllTrees,
  CurrentPageTargets,
} from "@shared/dom";
import { NodeType } from "@shared/dom";
import { SnapshotProcessor } from "../processors/SnapshotProcessor";
import { CoordinateTransformer } from "../processors/CoordinateTransformer";

/**
 * Builds enhanced DOM trees from CDP data sources
 */
export class DOMTreeBuilder {
  /**
   * Build enhanced DOM tree from all CDP data sources
   *
   * @param trees - Complete tree data from CDP commands
   * @param targets - Target information for the page
   * @returns Enhanced DOM tree root node
   */
  static buildEnhancedDOMTree(
    trees: TargetAllTrees,
    targets: CurrentPageTargets
  ): EnhancedDOMTreeNode {
    const { snapshot, domTree, axTree, devicePixelRatio } = trees;

    // Build lookup tables for efficient access
    const axTreeLookup = DOMTreeBuilder.buildAXTreeLookup(axTree.nodes);
    const snapshotLookup = SnapshotProcessor.buildSnapshotLookup(snapshot, devicePixelRatio);

    // Create node lookup for parent relationships
    const nodeLookup: Record<number, EnhancedDOMTreeNode> = {};

    // Build the enhanced tree recursively
    const enhancedRoot = DOMTreeBuilder.constructEnhancedNode(
      domTree.root,
      axTreeLookup,
      snapshotLookup,
      nodeLookup,
      targets.pageSession.targetId,
      devicePixelRatio
    );

    return enhancedRoot;
  }

  /**
   * Build accessibility tree lookup for efficient node access
   *
   * @param axNodes - Accessibility nodes from CDP
   * @returns Lookup table mapping backend node IDs to accessibility nodes
   */
  private static buildAXTreeLookup(
    axNodes: Array<{
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
    }>
  ): Record<number, EnhancedAXNode> {
    const lookup: Record<number, EnhancedAXNode> = {};

    for (const axNode of axNodes) {
      if (axNode.backendDOMNodeId) {
        lookup[axNode.backendDOMNodeId] = DOMTreeBuilder.buildEnhancedAXNode(axNode);
      }
    }

    return lookup;
  }

  /**
   * Build enhanced accessibility node from CDP data
   *
   * @param axNode - Raw accessibility node from CDP
   * @returns Enhanced accessibility node
   */
  private static buildEnhancedAXNode(axNode: {
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
  }): EnhancedAXNode {
    const properties: EnhancedAXProperty[] | undefined = axNode.properties
      ? axNode.properties
          .filter((prop) => prop.name && prop.value !== undefined)
          .map((prop): EnhancedAXProperty => {
            let value: string | boolean | null = null;

            if (typeof prop.value === 'object' && prop.value !== null && 'value' in prop.value) {
              // Handle the case where value is an object with a 'value' property
              value = prop.value.value || null;
            } else if (typeof prop.value === 'string' || typeof prop.value === 'boolean') {
              // Handle direct string or boolean values
              value = prop.value;
            }

            return {
              name: prop.name,
              value,
            };
          })
      : undefined;

    return {
      axNodeId: axNode.nodeId || axNode.backendDOMNodeId?.toString() || 'unknown',
      ignored: axNode.ignored || false,
      role: axNode.role?.value || null,
      name: axNode.name?.value || null,
      description: axNode.description?.value || null,
      properties,
      childIds: axNode.childIds || null,
    };
  }

  /**
   * Recursively construct enhanced DOM node
   *
   * @param node - Raw DOM node from CDP
   * @param axTreeLookup - Accessibility tree lookup
   * @param snapshotLookup - Snapshot data lookup
   * @param nodeLookup - Node lookup for parent relationships
   * @param targetId - Target ID for this context
   * @param devicePixelRatio - Device pixel ratio
   * @param totalFrameOffset - Accumulated frame offset for nested iframes
   * @returns Enhanced DOM node
   */
  private static constructEnhancedNode(
    node: {
      nodeId: number;
      backendNodeId: number;
      nodeType: number;
      nodeName: string;
      nodeValue?: string;
      attributes?: string[];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      children?: any[]; // DOMDocument from CDP
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      shadowRoots?: any[]; // DOMDocument from CDP
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      contentDocument?: any; // DOMDocument from CDP
      frameId?: string;
      isScrollable?: boolean;
      shadowRootType?: string;
      parentId?: number;
    },
    axTreeLookup: Record<number, EnhancedAXNode>,
    snapshotLookup: Record<number, {
      isClickable?: boolean;
      cursorStyle?: string;
      bounds?: DOMRect | null;
      clientRects?: DOMRect | null;
      scrollRects?: DOMRect | null;
      computedStyles?: Record<string, string> | null;
      paintOrder?: number;
      stackingContexts?: number;
    }>,
    nodeLookup: Record<number, EnhancedDOMTreeNode>,
    targetId: string,
    devicePixelRatio: number,
    totalFrameOffset: DOMRect = { x: 0, y: 0, width: 0, height: 0, toDict() { return { x: this.x, y: this.y, width: this.width, height: this.height }; } }
  ): EnhancedDOMTreeNode {
    // Check if we've already processed this node
    if (nodeLookup[node.nodeId]) {
      return nodeLookup[node.nodeId];
    }

    // Get accessibility data
    const axNode = axTreeLookup[node.backendNodeId];

    // Parse attributes into key-value pairs
    const attributes: Record<string, string> = node.attributes
      ? DOMTreeBuilder.parseAttributes(node.attributes)
      : {};

    // Get snapshot data
    const snapshotData = snapshotLookup[node.backendNodeId];

    // Calculate absolute position
    const absolutePosition = snapshotData?.bounds
      ? CoordinateTransformer.calculateAbsolutePosition(
          { snapshotNode: snapshotData } as EnhancedDOMTreeNode,
          totalFrameOffset
        )
      : null;

    // Create enhanced node
    const enhancedNode: EnhancedDOMTreeNode = {
      // Basic DOM properties
      nodeId: node.nodeId,
      backendNodeId: node.backendNodeId,
      nodeType: node.nodeType,
      nodeName: node.nodeName,
      nodeValue: node.nodeValue || '',
      attributes,

      // Layout and visibility
      isScrollable: node.isScrollable || false,
      isVisible: undefined, // Will be calculated later
      absolutePosition,

      // Frame information
      targetId,
      frameId: node.frameId || null,
      sessionId: null, // Will be set by DOMService

      // Shadow DOM
      shadowRootType: node.shadowRootType || null,
      shadowRoots: [], // Will be populated later

      // Navigation
      parentNode: undefined, // Will be set later
      childrenNodes: [], // Will be populated later

      // Content document (for iframes)
      contentDocument: null, // Will be populated later

      // Accessibility data
      axNode,

      // Snapshot data
      snapshotNode: snapshotData,

      // Interactive element index
      elementIndex: null, // Will be assigned later

      // Compound control information
      _compoundChildren: [] as Array<Array<Record<string, unknown>>>,

      // UUID for identification
      uuid: DOMTreeBuilder.generateUUID(),

      // Helper properties (computed when needed)
      get tag() {
        return this.nodeName.toLowerCase();
      },

      get children() {
        return this.childrenNodes || [];
      },

      get childrenAndShadowRoots() {
        const children = [...(this.childrenNodes || [])];
        if (this.shadowRoots) {
          children.push(...this.shadowRoots);
        }
        return children;
      },

      get parent() {
        return this.parentNode || null;
      },

      get isActuallyScrollable() {
        if (!this.snapshotNode) {
          return false;
        }

        return SnapshotProcessor.isElementScrollable(
          this.snapshotNode.scrollRects || null,
          this.snapshotNode.clientRects || null,
          this.snapshotNode.computedStyles || null
        );
      },

      get shouldShowScrollInfo() {
        // Always show for iframe elements
        if (this.tag === 'iframe') {
          return true;
        }

        // Must be scrollable for non-iframe elements
        if (!this.isScrollable && !this.isActuallyScrollable) {
          return false;
        }

        // Show for body/html elements
        if (this.tag && ['body', 'html'].includes(this.tag)) {
          return true;
        }

        // Don't show if parent is already scrollable
        if (this.parent && (this.parent.isScrollable || this.parent.isActuallyScrollable)) {
          return false;
        }

        return true;
      },

      get scrollInfo() {
        if (!this.isActuallyScrollable || !this.snapshotNode) {
          return null;
        }

        const scrollInfo = SnapshotProcessor.extractScrollInfo(
          this.snapshotNode.scrollRects || null,
          this.snapshotNode.clientRects || null
        );

        if (!scrollInfo) {
          return null;
        }

        // Calculate additional scroll information
        const contentAbove = Math.max(0, scrollInfo.scrollTop);
        const contentBelow = Math.max(0, scrollInfo.scrollableHeight - scrollInfo.visibleHeight - scrollInfo.scrollTop);
        const contentLeft = Math.max(0, scrollInfo.scrollLeft);
        const contentRight = Math.max(0, scrollInfo.scrollableWidth - scrollInfo.visibleWidth - scrollInfo.scrollLeft);

        // Calculate scroll percentages
        const scrollPercentages = CoordinateTransformer.calculateScrollPercentage(
          this.snapshotNode.bounds || { x: 0, y: 0, width: 0, height: 0, toDict() { return {}; } },
          scrollInfo
        );

        // Calculate pages equivalent
        const pagesAbove = contentAbove / scrollInfo.visibleHeight;
        const pagesBelow = contentBelow / scrollInfo.visibleHeight;
        const totalPages = scrollInfo.scrollableHeight / scrollInfo.visibleHeight;

        return {
          ...scrollInfo,
          contentAbove,
          contentBelow,
          contentLeft,
          contentRight,
          verticalScrollPercentage: scrollPercentages.vertical,
          horizontalScrollPercentage: scrollPercentages.horizontal,
          pagesAbove: Math.round(pagesAbove * 10) / 10,
          pagesBelow: Math.round(pagesBelow * 10) / 10,
          totalPages: Math.round(totalPages * 10) / 10,
          canScrollUp: contentAbove > 0,
          canScrollDown: contentBelow > 0,
          canScrollLeft: contentLeft > 0,
          canScrollRight: contentRight > 0,
        };
      },

      get elementHash() {
        return DOMTreeBuilder.calculateElementHash(this);
      },

      get xpath() {
        return DOMTreeBuilder.generateXPath(this);
      },
    };

    // Store in lookup for parent relationships
    nodeLookup[node.nodeId] = enhancedNode;

    // Set parent relationship if parentId exists
    if (node.parentId && nodeLookup[node.parentId]) {
      enhancedNode.parentNode = nodeLookup[node.parentId];
    }

    // Process content document for iframes
    if (node.contentDocument) {
      // For iframes, we'll need to recursively process the content document
      // This will be handled by the DOMService when it processes multiple targets
      enhancedNode.contentDocument = node.contentDocument as EnhancedDOMTreeNode;
    }

    // Process shadow roots
    if (node.shadowRoots && node.shadowRoots.length > 0) {
      enhancedNode.shadowRoots = [];
      for (const shadowRoot of node.shadowRoots) {
        const shadowNode = DOMTreeBuilder.constructEnhancedNode(
          shadowRoot,
          axTreeLookup,
          snapshotLookup,
          nodeLookup,
          targetId,
          devicePixelRatio,
          totalFrameOffset
        );
        shadowNode.parentNode = enhancedNode;
        enhancedNode.shadowRoots.push(shadowNode);
      }
    }

    // Process children
    if (node.children && node.children.length > 0) {
      enhancedNode.childrenNodes = [];

      // Build set of shadow root node IDs to filter them out from children
      const shadowRootNodeIds = new Set(
        node.shadowRoots?.map((root) => root.nodeId) || []
      );

      for (const child of node.children) {
        // Skip shadow roots - they should only be in shadowRoots list
        if (shadowRootNodeIds.has(child.nodeId)) {
          continue;
        }

        const childNode = DOMTreeBuilder.constructEnhancedNode(
          child,
          axTreeLookup,
          snapshotLookup,
          nodeLookup,
          targetId,
          devicePixelRatio,
          totalFrameOffset
        );
        childNode.parentNode = enhancedNode;
        enhancedNode.childrenNodes.push(childNode);
      }
    }

    return enhancedNode;
  }

  /**
   * Parse attributes array into key-value pairs
   *
   * @param attributes - Attributes array from CDP (alternating key/value)
   * @returns Attributes as key-value pairs
   */
  private static parseAttributes(attributes: string[]): Record<string, string> {
    const result: Record<string, string> = {};

    for (let i = 0; i < attributes.length; i += 2) {
      const key = attributes[i];
      const value = attributes[i + 1] || '';
      if (key) {
        result[key] = value;
      }
    }

    return result;
  }

  /**
   * Generate a simple UUID for node identification
   *
   * @returns UUID string
   */
  private static generateUUID(): string {
    return Math.random().toString(36).substring(2, 15) +
           Math.random().toString(36).substring(2, 15);
  }

  /**
   * Calculate element hash for identification
   *
   * @param node - Enhanced DOM node
   * @returns Hash value
   */
  private static calculateElementHash(node: EnhancedDOMTreeNode): number {
    // Simple hash based on node properties
    const hashString = `${node.nodeId}-${node.backendNodeId}-${node.nodeName}-${node.targetId}`;
    let hash = 0;
    for (let i = 0; i < hashString.length; i++) {
      const char = hashString.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash;
  }

  /**
   * Generate XPath for a DOM node
   *
   * @param node - Enhanced DOM node
   * @returns XPath string
   */
  private static generateXPath(node: EnhancedDOMTreeNode): string {
    const segments: string[] = [];
    let currentElement: EnhancedDOMTreeNode | null = node;

    while (currentElement && (
      currentElement.nodeType === NodeType.ELEMENT_NODE ||
      currentElement.nodeType === NodeType.DOCUMENT_FRAGMENT_NODE
    )) {
      // Skip document fragments (shadow roots)
      if (currentElement.nodeType === NodeType.DOCUMENT_FRAGMENT_NODE) {
        currentElement = currentElement.parent;
        continue;
      }

      // Stop at iframe boundaries
      if (currentElement.parent && currentElement.parent.nodeName.toLowerCase() === 'iframe') {
        break;
      }

      const position = DOMTreeBuilder.getElementPosition(currentElement);
      const tagName = currentElement.nodeName.toLowerCase();
      const xpathIndex = position > 0 ? `[${position}]` : '';
      segments.unshift(`${tagName}${xpathIndex}`);

      currentElement = currentElement.parent;
    }

    return '/' + segments.join('/');
  }

  /**
   * Get position of element among siblings with same tag name
   *
   * @param element - Enhanced DOM element
   * @returns Position (0-based, but return 1+ for XPath if > 0)
   */
  private static getElementPosition(element: EnhancedDOMTreeNode): number {
    if (!element.parent || !element.parent.childrenNodes) {
      return 0;
    }

    const sameTagSiblings = element.parent.childrenNodes.filter(
      child => child.nodeType === NodeType.ELEMENT_NODE &&
               child.nodeName.toLowerCase() === element.nodeName.toLowerCase()
    );

    if (sameTagSiblings.length <= 1) {
      return 0; // No index needed if it's the only one
    }

    // XPath is 1-indexed
    return sameTagSiblings.indexOf(element) + 1;
  }

  /**
   * Calculate visibility for all nodes in the tree
   *
   * @param node - Root node to calculate visibility for
   */
  static calculateVisibility(node: EnhancedDOMTreeNode): void {
    // Skip non-element nodes
    if (node.nodeType !== NodeType.ELEMENT_NODE) {
      node.isVisible = false;
      return;
    }

    // Calculate visibility based on computed styles
    if (node.snapshotNode?.computedStyles) {
      node.isVisible = SnapshotProcessor.isElementVisible(node.snapshotNode.computedStyles);
    } else {
      // Default to visible for elements without style info
      node.isVisible = true;
    }

    // Recursively calculate visibility for children
    for (const child of node.childrenAndShadowRoots) {
      DOMTreeBuilder.calculateVisibility(child);
    }
  }
}