/**
 * DOM Tree Serializer - 6-stage serialization pipeline
 *
 * Main orchestrator for DOM serialization with comprehensive pipeline:
 * 1. Create simplified tree with compound controls
 * 2. Apply paint order filtering
 * 3. Optimize tree structure
 * 4. Apply bounding box filtering
 * 5. Assign interactive indices
 * 6. Mark new elements for change detection
 */

import type {
  EnhancedDOMTreeNode,
  SerializedDOMState,
  SimplifiedNode,
  DOMSelectorMap,
  SerializationConfig,
  SerializationStats
} from "@shared/dom";

import { InteractiveElementDetector } from "./InteractiveElementDetector";
import { PaintOrderAnalyzer } from "./PaintOrderAnalyzer";
import { BoundingBoxFilter } from "./BoundingBoxFilter";
import { CompoundComponentBuilder } from "./CompoundComponentBuilder";

/**
 * Timing information for serialization stages
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
 * DOM Tree Serializer with comprehensive pipeline
 */
export class DOMTreeSerializer {
  private readonly config: SerializationConfig;
  private readonly interactiveDetector: typeof InteractiveElementDetector;
  private readonly paintOrderAnalyzer: PaintOrderAnalyzer;
  private readonly boundingBoxFilter: BoundingBoxFilter;
  private readonly compoundComponentBuilder: CompoundComponentBuilder;

  constructor(config: Partial<SerializationConfig> = {}) {
    this.config = {
      enablePaintOrderFiltering: true,
      enableBoundingBoxFiltering: true,
      enableCompoundComponents: true,
      opacityThreshold: 0.8,
      containmentThreshold: 0.99,
      maxInteractiveElements: 1000,
      ...config
    };

    this.interactiveDetector = InteractiveElementDetector;
    this.paintOrderAnalyzer = new PaintOrderAnalyzer({
      opacityThreshold: this.config.opacityThreshold,
      enableTransparencyFiltering: this.config.enablePaintOrderFiltering
    });
    this.boundingBoxFilter = new BoundingBoxFilter({
      containmentThreshold: this.config.containmentThreshold
    });
    this.compoundComponentBuilder = new CompoundComponentBuilder();
  }

  /**
   * Main serialization method - orchestrates the entire pipeline
   */
  async serializeDOMTree(
    rootNode: EnhancedDOMTreeNode,
    previousState?: SerializedDOMState,
    config?: Partial<SerializationConfig>
  ): Promise<{
    serializedState: SerializedDOMState;
    timing: SerializationTiming;
    stats: SerializationStats;
  }> {
    const startTime = Date.now();

    // Apply config overrides
    const effectiveConfig = {
      ...this.config,
      ...config
    };

    const timing: SerializationTiming = {
      total: 0,
      createSimplifiedTree: 0,
      paintOrderFiltering: 0,
      optimizeTreeStructure: 0,
      boundingBoxFiltering: 0,
      assignInteractiveIndices: 0,
      markNewElements: 0
    };

    try {
      // Stage 1: Create simplified tree with compound controls
      const stage1Start = Date.now();
      const simplifiedRoot = this.createSimplifiedTree(rootNode);
      timing.createSimplifiedTree = Date.now() - stage1Start;

      // Stage 2: Apply paint order filtering
      const stage2Start = Date.now();
      if (effectiveConfig.enablePaintOrderFiltering) {
        this.applyPaintOrderFiltering(simplifiedRoot);
      }
      timing.paintOrderFiltering = Date.now() - stage2Start;

      // Stage 3: Optimize tree structure
      const stage3Start = Date.now();
      this.optimizeTreeStructure(simplifiedRoot);
      timing.optimizeTreeStructure = Date.now() - stage3Start;

      // Stage 4: Apply bounding box filtering
      const stage4Start = Date.now();
      if (effectiveConfig.enableBoundingBoxFiltering) {
        this.applyBoundingBoxFiltering(simplifiedRoot);
      }
      timing.boundingBoxFiltering = Date.now() - stage4Start;

      // Stage 5: Assign interactive indices
      const stage5Start = Date.now();
      this.assignInteractiveIndices(simplifiedRoot, effectiveConfig.maxInteractiveElements);
      timing.assignInteractiveIndices = Date.now() - stage5Start;

      // Stage 6: Mark new elements for change detection
      const stage6Start = Date.now();
      this.markNewElements(simplifiedRoot, previousState);
      timing.markNewElements = Date.now() - stage6Start;

      // Build selector map
      const selectorMap = this.buildSelectorMap(simplifiedRoot);

      // Calculate statistics
      const stats = this.calculateStats(simplifiedRoot);

      timing.total = Date.now() - startTime;

      return {
        serializedState: {
          root: simplifiedRoot,
          selectorMap
        },
        timing,
        stats
      };

    } catch (error) {
      throw new Error(`DOM serialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Stage 1: Create simplified tree structure
   */
  private createSimplifiedTree(rootNode: EnhancedDOMTreeNode): SimplifiedNode {
    return this.convertToSimplifiedNode(rootNode);
  }

  /**
   * Convert EnhancedDOMTreeNode to SimplifiedNode
   */
  private convertToSimplifiedNode(node: EnhancedDOMTreeNode): SimplifiedNode {
    const simplifiedNode: SimplifiedNode = {
      originalNode: node,
      children: [],
      shouldDisplay: this.shouldDisplayNode(node),
      interactiveIndex: null,
      isNew: false,
      ignoredByPaintOrder: false,
      excludedByParent: false,
      isShadowHost: !!node.shadowRootType,
      isCompoundComponent: false,
      hasCompoundChildren: false,
      isLeaf: false,
      depth: 0,
      nodeHash: node.elementHash || 0,
      interactiveElement: false,
      hasChildren: false,
      xpath: '',
      tagName: node.tag || '',
      textContent: node.nodeValue || ''
    };

    // Process children and shadow roots
    const childrenAndShadows = node.childrenAndShadowRoots;
    for (const child of childrenAndShadows) {
      simplifiedNode.children.push(this.convertToSimplifiedNode(child));
    }

    // Handle compound components
    if (this.config.enableCompoundComponents) {
      this.compoundComponentBuilder.buildCompoundComponents(simplifiedNode);
    }

    return simplifiedNode;
  }

  /**
   * Check if node should be displayed in simplified tree
   */
  private shouldDisplayNode(node: EnhancedDOMTreeNode): boolean {
    // Skip text nodes without content
    if (node.nodeType === 3 && (!node.nodeValue || !node.nodeValue.trim())) {
      return false;
    }

    // Skip comment nodes
    if (node.nodeType === 8) {
      return false;
    }

    // Skip nodes that are explicitly hidden
    if (node.isVisible === false) {
      return false;
    }

    // Check computed styles for visibility
    if (node.snapshotNode?.computedStyles) {
      const styles = node.snapshotNode.computedStyles;
      if (styles.display === 'none' || styles.visibility === 'hidden') {
        return false;
      }
    }

    return true;
  }

  /**
   * Stage 2: Apply paint order filtering
   */

  /**
   * Stage 2: Apply paint order filtering
   */
  private applyPaintOrderFiltering(root: SimplifiedNode): void {
    // Flatten tree for processing
    const allNodes = this.flattenTree(root);

    // Filter using paint order analyzer
    this.paintOrderAnalyzer.filterNodes(allNodes);
  }

  /**
   * Stage 3: Optimize tree structure
   */
  private optimizeTreeStructure(root: SimplifiedNode): void {
    // Remove nodes that are marked as filtered
    this.removeFilteredNodes(root);

    // Optimize text nodes
    this.optimizeTextNodes(root);

    // Optimize container nodes
    this.optimizeContainerNodes(root);
  }

  /**
   * Remove filtered nodes from tree
   */
  private removeFilteredNodes(node: SimplifiedNode): void {
    node.children = node.children.filter(child => {
      if (child.ignoredByPaintOrder || child.excludedByParent) {
        return false;
      }

      // Recursively clean children
      this.removeFilteredNodes(child);
      return true;
    });
  }

  /**
   * Optimize text nodes by combining adjacent text
   */
  private optimizeTextNodes(node: SimplifiedNode): void {
    const optimizedChildren: SimplifiedNode[] = [];
    let currentTextGroup: SimplifiedNode[] = [];

    for (const child of node.children) {
      this.optimizeTextNodes(child);

      if (child.originalNode.nodeType === 3) { // Text node
        currentTextGroup.push(child);
      } else {
        // Flush current text group
        if (currentTextGroup.length > 0) {
          optimizedChildren.push(...this.combineTextNodes(currentTextGroup));
          currentTextGroup = [];
        }
        optimizedChildren.push(child);
      }
    }

    // Flush remaining text group
    if (currentTextGroup.length > 0) {
      optimizedChildren.push(...this.combineTextNodes(currentTextGroup));
    }

    node.children = optimizedChildren;
  }

  /**
   * Combine adjacent text nodes
   */
  private combineTextNodes(textNodes: SimplifiedNode[]): SimplifiedNode[] {
    if (textNodes.length === 1) {
      return textNodes;
    }

    // Combine into a single text node
    const combinedText = textNodes
      .map(node => node.originalNode.nodeValue || '')
      .join('')
      .trim();

    if (!combinedText) {
      return [];
    }

    const combinedNode: SimplifiedNode = {
      originalNode: {
        ...textNodes[0].originalNode,
        nodeValue: combinedText
      },
      children: [],
      shouldDisplay: true,
      interactiveIndex: null,
      isNew: false,
      ignoredByPaintOrder: false,
      excludedByParent: false,
      isShadowHost: false,
      isCompoundComponent: false,
      hasCompoundChildren: false,
      isLeaf: false,
      depth: 0,
      nodeHash: textNodes[0].originalNode.elementHash || 0,
      interactiveElement: false,
      hasChildren: false,
      xpath: '',
      tagName: textNodes[0].originalNode.tag || '',
      textContent: combinedText
    };

    return [combinedNode];
  }

  /**
   * Optimize container nodes by removing unnecessary nesting
   */
  private optimizeContainerNodes(node: SimplifiedNode): void {
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];

      // If child is a simple container with only one child, merge it
      if (this.isSimpleContainer(child) && child.children.length === 1) {
        node.children[i] = child.children[0];
      }

      this.optimizeContainerNodes(node.children[i]);
    }
  }

  /**
   * Check if node is a simple container (div, span without attributes)
   */
  private isSimpleContainer(node: SimplifiedNode): boolean {
    const originalNode = node.originalNode;

    // Only div and span can be simple containers
    if (!['div', 'span'].includes(originalNode.tag?.toLowerCase() || '')) {
      return false;
    }

    // Must have no interactive properties
    if (node.interactiveIndex !== null || node.isCompoundComponent) {
      return false;
    }

    // Must have minimal attributes
    const attributes = Object.keys(originalNode.attributes);
    return attributes.length === 0;
  }

  /**
   * Stage 4: Apply bounding box filtering
   */
  private applyBoundingBoxFiltering(root: SimplifiedNode): void {
    if (this.config.enableBoundingBoxFiltering) {
      const stats = this.boundingBoxFilter.filterTree(root);

      // Track bounding box filtering statistics
      this.updateBoundingBoxFilteringStats(stats);
    }
  }

  /**
   * Update bounding box filtering statistics
   */
  private updateBoundingBoxFilteringStats(_stats: { filteredCount: number; retainedCount: number }): void {
    // Update internal tracking for stats calculation
    // This would be integrated into the main stats calculation
  }

  /**
   * Stage 5: Assign interactive indices
   */
  private assignInteractiveIndices(root: SimplifiedNode, maxInteractiveElements: number): void {
    const interactiveNodes = this.findInteractiveNodes(root);

    // Sort by DOM order for consistent indexing
    interactiveNodes.sort((a, b) => {
      const aOrder = this.getDOMOrder(a);
      const bOrder = this.getDOMOrder(b);
      return aOrder - bOrder;
    });

    // Assign indices
    let index = 0;
    for (const node of interactiveNodes) {
      if (index < maxInteractiveElements) {
        node.interactiveIndex = index++;
      }
    }
  }

  /**
   * Find all interactive nodes in tree
   */
  private findInteractiveNodes(node: SimplifiedNode): SimplifiedNode[] {
    const interactiveNodes: SimplifiedNode[] = [];

    // Check current node
    const isInteractive = this.interactiveDetector.isInteractive(node.originalNode);
    if (isInteractive && node.shouldDisplay) {
      interactiveNodes.push(node);
    }

    // Check compound children
    if (node.isCompoundComponent && node.originalNode._compoundChildren) {
      for (const _compoundChild of node.originalNode._compoundChildren) {
        // Compound children are always interactive
        interactiveNodes.push(node);
      }
    }

    // Recursively check children
    for (const child of node.children) {
      interactiveNodes.push(...this.findInteractiveNodes(child));
    }

    return interactiveNodes;
  }

  /**
   * Get DOM order for consistent sorting
   */
  private getDOMOrder(node: SimplifiedNode): number {
    return node.originalNode.nodeId;
  }

  /**
   * Stage 6: Mark new elements for change detection
   */
  private markNewElements(root: SimplifiedNode, previousState?: SerializedDOMState): void {
    if (!previousState) {
      // First time - mark all nodes as new
      this.markAllAsNew(root);
      return;
    }

    // Compare with previous state
    const previousNodeMap = this.buildNodeMap(previousState.root);
    this.compareWithPreviousState(root, previousNodeMap);
  }

  /**
   * Mark all nodes as new (for first-time serialization)
   */
  private markAllAsNew(node: SimplifiedNode): void {
    node.isNew = true;
    for (const child of node.children) {
      this.markAllAsNew(child);
    }
  }

  /**
   * Build map of nodes for efficient comparison
   */
  private buildNodeMap(root: SimplifiedNode): Map<number, SimplifiedNode> {
    const nodeMap = new Map<number, SimplifiedNode>();

    const traverse = (node: SimplifiedNode) => {
      const nodeId = node.originalNode.nodeId;
      nodeMap.set(nodeId, node);

      for (const child of node.children) {
        traverse(child);
      }
    };

    traverse(root);
    return nodeMap;
  }

  /**
   * Compare current state with previous state
   */
  private compareWithPreviousState(
    currentNode: SimplifiedNode,
    previousNodeMap: Map<number, SimplifiedNode>
  ): void {
    const nodeId = currentNode.originalNode.nodeId;
    const previousNode = previousNodeMap.get(nodeId);

    if (!previousNode) {
      // New node
      currentNode.isNew = true;
    } else if (!this.nodesEqual(currentNode, previousNode)) {
      // Changed node
      currentNode.isNew = true;
    } else {
      // Unchanged node
      currentNode.isNew = false;
    }

    // Compare children
    for (const child of currentNode.children) {
      this.compareWithPreviousState(child, previousNodeMap);
    }
  }

  /**
   * Check if two nodes are equal for change detection
   */
  private nodesEqual(node1: SimplifiedNode, node2: SimplifiedNode): boolean {
    // Compare basic properties
    if (node1.originalNode.nodeValue !== node2.originalNode.nodeValue) {
      return false;
    }

    // Compare attributes (simplified)
    const attrs1 = node1.originalNode.attributes;
    const attrs2 = node2.originalNode.attributes;

    const keys1 = Object.keys(attrs1);
    const keys2 = Object.keys(attrs2);

    if (keys1.length !== keys2.length) {
      return false;
    }

    for (const key of keys1) {
      if (attrs1[key] !== attrs2[key]) {
        return false;
      }
    }

    return true;
  }

  /**
   * Build selector map for element lookup
   */
  private buildSelectorMap(root: SimplifiedNode): DOMSelectorMap {
    const selectorMap: DOMSelectorMap = {};

    const traverse = (node: SimplifiedNode) => {
      if (node.interactiveIndex !== null) {
        selectorMap[node.interactiveIndex] = node.originalNode;
      }

      for (const child of node.children) {
        traverse(child);
      }
    };

    traverse(root);
    return selectorMap;
  }

  /**
   * Calculate serialization statistics
   */
  private calculateStats(root: SimplifiedNode): SerializationStats {
    let totalNodes = 0;
    let simplifiedNodes = 0;
    let filteredNodes = 0;
    let interactiveElements = 0;
    let newElements = 0;
    let occludedNodes = 0;
    let containedNodes = 0;
    let compoundComponents = 0;

    const traverse = (node: SimplifiedNode) => {
      totalNodes++;
      simplifiedNodes++;

      if (node.ignoredByPaintOrder || node.excludedByParent) {
        filteredNodes++;
        if (node.ignoredByPaintOrder) {
          occludedNodes++;
        }
        if (node.excludedByParent) {
          containedNodes++;
        }
      }

      if (node.interactiveIndex !== null) {
        interactiveElements++;
      }

      if (node.isNew) {
        newElements++;
      }

      if (node.isCompoundComponent) {
        compoundComponents++;
      }

      for (const child of node.children) {
        traverse(child);
      }
    };

    traverse(root);

    return {
      totalNodes,
      simplifiedNodes,
      filteredNodes,
      interactiveElements,
      newElements,
      occludedNodes,
      containedNodes,
      compoundComponents
    };
  }

  /**
   * Flatten tree into array of nodes
   */
  private flattenTree(root: SimplifiedNode): SimplifiedNode[] {
    const nodes: SimplifiedNode[] = [];

    const traverse = (node: SimplifiedNode) => {
      nodes.push(node);
      for (const child of node.children) {
        traverse(child);
      }
    };

    traverse(root);
    return nodes;
  }
}