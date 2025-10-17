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
  SerializationStats,
} from "@shared/dom";

import { InteractiveElementDetector } from "./InteractiveElementDetector";
import { PaintOrderAnalyzer } from "./PaintOrderAnalyzer";
import { BoundingBoxFilter } from "./BoundingBoxFilter";
import { CompoundComponentBuilder } from "./CompoundComponentBuilder";

/**
 * Node hash cache for efficient change detection
 */
interface NodeHashCache {
  nodeId: number;
  hash: string;
  lastModified: number;
}

/**
 * Enhanced change detection result
 */
interface ChangeDetectionResult {
  isChanged: boolean;
  changeType: "new" | "modified" | "unchanged";
  changeDetails: string[];
}

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

  // Enhanced change detection caches
  private nodeHashCache: Map<number, NodeHashCache> = new Map();
  private layoutIndexMap: Map<number, number> = new Map();
  private duplicateNodeMap: Map<string, number[]> = new Map();

  constructor(config: Partial<SerializationConfig> = {}) {
    this.config = {
      enablePaintOrderFiltering: true,
      enableBoundingBoxFiltering: true,
      enableCompoundComponents: true,
      opacityThreshold: 0.8,
      containmentThreshold: 0.99,
      maxInteractiveElements: 1000,
      ...config,
    };

    this.interactiveDetector = InteractiveElementDetector;
    this.paintOrderAnalyzer = new PaintOrderAnalyzer({
      opacityThreshold: this.config.opacityThreshold,
      enableTransparencyFiltering: this.config.enablePaintOrderFiltering,
    });
    this.boundingBoxFilter = new BoundingBoxFilter({
      containmentThreshold: this.config.containmentThreshold,
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
      ...config,
    };

    const timing: SerializationTiming = {
      total: 0,
      createSimplifiedTree: 0,
      paintOrderFiltering: 0,
      optimizeTreeStructure: 0,
      boundingBoxFiltering: 0,
      assignInteractiveIndices: 0,
      markNewElements: 0,
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
      this.assignInteractiveIndices(
        simplifiedRoot,
        effectiveConfig.maxInteractiveElements
      );
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
          selectorMap,
        },
        timing,
        stats,
      };
    } catch (error) {
      throw new Error(
        `DOM serialization failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
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
      xpath: "",
      tagName: node.tag || "",
      textContent: node.nodeValue || "",
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
      if (styles.display === "none" || styles.visibility === "hidden") {
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
    node.children = node.children.filter((child) => {
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

      if (child.originalNode.nodeType === 3) {
        // Text node
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
      .map((node) => node.originalNode.nodeValue || "")
      .join("")
      .trim();

    if (!combinedText) {
      return [];
    }

    const combinedNode: SimplifiedNode = {
      originalNode: {
        ...textNodes[0].originalNode,
        nodeValue: combinedText,
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
      xpath: "",
      tagName: textNodes[0].originalNode.tag || "",
      textContent: combinedText,
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
    if (!["div", "span"].includes(originalNode.tag?.toLowerCase() || "")) {
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
  private updateBoundingBoxFilteringStats(_stats: {
    filteredCount: number;
    retainedCount: number;
  }): void {
    // Update internal tracking for stats calculation
    // This would be integrated into the main stats calculation
  }

  /**
   * Stage 5: Assign interactive indices
   */
  private assignInteractiveIndices(
    root: SimplifiedNode,
    maxInteractiveElements: number
  ): void {
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
    const isInteractive = this.interactiveDetector.isInteractive(
      node.originalNode
    );
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
  private markNewElements(
    root: SimplifiedNode,
    previousState?: SerializedDOMState
  ): void {
    if (!previousState) {
      // First time - mark all nodes as new
      this.markAllAsNew(root);
      return;
    }

    // Build enhanced caches for comparison
    this.buildCaches(root, previousState.root);

    // Compare with previous state using enhanced change detection
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
      compoundComponents,
    };
  }

  /**
   * Build enhanced caches for change detection optimization
   * Follows browser-use patterns with layout index mapping for O(n) efficiency
   */
  private buildCaches(
    currentRoot: SimplifiedNode,
    previousRoot: SimplifiedNode
  ): void {
    // Clear previous caches
    this.nodeHashCache.clear();
    this.layoutIndexMap.clear();
    this.duplicateNodeMap.clear();

    // Build layout index mapping for efficient O(n) lookups instead of O(n²)
    // This is critical for performance - matches browser-use reference exactly
    let index = 0;
    const traverseForLayout = (node: SimplifiedNode) => {
      this.layoutIndexMap.set(node.originalNode.nodeId, index++);
      for (const child of node.children) {
        traverseForLayout(child);
      }
    };
    traverseForLayout(currentRoot);

    // Build hash cache and detect duplicates simultaneously
    const hashMap = new Map<string, number[]>();
    const traverseForHash = (node: SimplifiedNode) => {
      const hash = this.calculateNodeHash(node.originalNode);

      // Store in hash cache with timestamp
      this.nodeHashCache.set(node.originalNode.nodeId, {
        nodeId: node.originalNode.nodeId,
        hash,
        lastModified: Date.now(),
      });

      // Track duplicates for optimization
      if (!hashMap.has(hash)) {
        hashMap.set(hash, []);
      }
      hashMap.get(hash)!.push(node.originalNode.nodeId);

      for (const child of node.children) {
        traverseForHash(child);
      }
    };
    traverseForHash(currentRoot);

    // Store duplicate mappings for debugging and optimization
    for (const [hash, nodeIds] of hashMap) {
      if (nodeIds.length > 1) {
        this.duplicateNodeMap.set(hash, nodeIds);
      }
    }
  }

  /**
   * Calculate comprehensive hash for a node
   * Matches browser-use reference patterns for accurate change detection
   * IMPORTANT: Excludes bounds to prevent false positives during layout shifts
   */
  private calculateNodeHash(node: EnhancedDOMTreeNode): string {
    const hashComponents: string[] = [];

    // Basic node properties (essential for identity)
    hashComponents.push(`type:${node.nodeType}`);
    hashComponents.push(`tag:${node.tag || ""}`);
    hashComponents.push(`value:${(node.nodeValue || "").trim()}`);

    // Attributes (sorted for consistency - critical for stable hashing)
    // Only include attributes that actually affect behavior/appearance
    if (node.attributes) {
      const significantAttrs = [
        'id', 'class', 'name', 'type', 'value', 'placeholder', 'title', 'alt',
        'role', 'aria-label', 'aria-expanded', 'aria-checked', 'aria-disabled',
        'data-testid', 'data-test', 'href', 'src', 'onclick', 'tabindex'
      ];

      const sortedKeys = Object.keys(node.attributes)
        .filter(key => significantAttrs.includes(key) || key.startsWith('data-') || key.startsWith('aria-'))
        .sort();

      for (const key of sortedKeys) {
        const value = node.attributes[key];
        if (value && value.trim()) {
          hashComponents.push(`${key}:${value.trim()}`);
        }
      }
    }

    // Computed styles that affect appearance and behavior
    // Only styles that actually impact the element's presentation
    if (node.snapshotNode?.computedStyles) {
      const criticalStyles = [
        "display", "visibility", "opacity", "background-color", "color",
        "cursor", "pointer-events", "position", "overflow", "overflow-x", "overflow-y"
      ];

      for (const key of criticalStyles) {
        const value = node.snapshotNode.computedStyles[key];
        if (value !== undefined && value !== 'initial' && value !== 'auto') {
          hashComponents.push(`style:${key}:${value}`);
        }
      }
    }

    // Accessibility properties (critical for screen reader compatibility)
    if (node.axNode) {
      if (node.axNode.role && node.axNode.role !== node.tag) {
        hashComponents.push(`role:${node.axNode.role}`);
      }
      if (node.axNode.name && node.axNode.name.trim()) {
        hashComponents.push(`ax_name:${node.axNode.name.trim()}`);
      }
      if (node.axNode.description && node.axNode.description.trim()) {
        hashComponents.push(`ax_desc:${node.axNode.description.trim()}`);
      }

      // Important accessibility properties that affect interaction
      if (node.axNode.properties) {
        const importantProps = ['disabled', 'checked', 'selected', 'expanded', 'pressed', 'invalid'];
        for (const prop of node.axNode.properties) {
          if (importantProps.includes(prop.name) && prop.value !== undefined) {
            hashComponents.push(`ax:${prop.name}:${prop.value}`);
          }
        }
      }
    }

    // Compound component state (virtual components affect interaction)
    if (node._compoundChildren && node._compoundChildren.length > 0) {
      hashComponents.push("compound:true");
      // Sort compound children for stable hashing
      const sortedChildren = [...node._compoundChildren].sort((a, b) =>
        `${a.role}:${a.name}`.localeCompare(`${b.role}:${b.name}`)
      );

      for (const child of sortedChildren) {
        hashComponents.push(`child:${child.role}:${child.name}`);
        if (child.valuemin !== undefined) hashComponents.push(`min:${child.valuemin}`);
        if (child.valuemax !== undefined) hashComponents.push(`max:${child.valuemax}`);
        if (child.valuenow !== undefined) hashComponents.push(`now:${child.valuenow}`);
      }
    }

    // REMOVED: Bounds information from hash calculation
    // Bounds change frequently during layout shifts and cause false positives
    // Change detection should focus on content/behavior changes, not position changes
    // Reference: browser-use does not include bounds in change detection hashes

    // Create final hash string
    const hashString = hashComponents.join("|");
    return this.simpleHash(hashString);
  }

  /**
   * Simple hash function for change detection
   */
  private simpleHash(str: string): string {
    let hash = 0;
    if (str.length === 0) return hash.toString();

    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }

    return Math.abs(hash).toString(36);
  }

  /**
   * Enhanced comparison with previous state using hashes and caches
   * Matches browser-use reference for accurate change detection
   */
  private compareWithPreviousState(
    currentNode: SimplifiedNode,
    previousNodeMap: Map<number, SimplifiedNode>
  ): void {
    const nodeId = currentNode.originalNode.nodeId;
    const previousNode = previousNodeMap.get(nodeId);
    const currentNodeHash = this.nodeHashCache.get(nodeId);

    if (!previousNode) {
      // New node - this is a genuine change
      currentNode.isNew = true;
    } else if (!currentNodeHash) {
      // No hash available - assume changed (conservative approach)
      currentNode.isNew = true;
    } else {
      // Compare using enhanced change detection with proper hash comparison
      const changeResult = this.detectNodeChanges(
        currentNode,
        previousNode,
        currentNodeHash.hash
      );
      currentNode.isNew = changeResult.isChanged;

      // Enhanced change type classification
      if (changeResult.isChanged) {
        this.enhanceChangeDetection(currentNode, previousNode, changeResult);
      }
    }

    // Recursively compare children
    for (const child of currentNode.children) {
      this.compareWithPreviousState(child, previousNodeMap);
    }
  }

  /**
   * Enhanced change detection for individual nodes
   * Matches browser-use reference with comprehensive comparison logic
   */
  private detectNodeChanges(
    current: SimplifiedNode,
    previous: SimplifiedNode,
    currentHash: string
  ): ChangeDetectionResult {
    const changeDetails: string[] = [];

    // Quick hash comparison first - most efficient path
    const previousHash = this.nodeHashCache.get(previous.originalNode.nodeId)?.hash;
    if (previousHash && previousHash === currentHash) {
      return { isChanged: false, changeType: "unchanged", changeDetails: [] };
    }

    // Detailed comparison when hash differs
    const currentNode = current.originalNode;
    const previousNode = previous.originalNode;

    // Check text content changes (significant for text nodes)
    const currentText = (currentNode.nodeValue || "").trim();
    const previousText = (previousNode.nodeValue || "").trim();
    if (currentText !== previousText) {
      if (currentText.length > 0 && previousText.length === 0) {
        changeDetails.push("text added");
      } else if (currentText.length === 0 && previousText.length > 0) {
        changeDetails.push("text removed");
      } else {
        changeDetails.push("text modified");
      }
    }

    // Check attribute changes with detailed analysis
    const currentAttrs = currentNode.attributes || {};
    const previousAttrs = previousNode.attributes || {};
    const allKeys = new Set([
      ...Object.keys(currentAttrs),
      ...Object.keys(previousAttrs),
    ]);

    for (const key of allKeys) {
      const currentVal = currentAttrs[key]?.trim() || "";
      const previousVal = previousAttrs[key]?.trim() || "";

      if (currentVal !== previousVal) {
        if (currentVal.length > 0 && previousVal.length === 0) {
          changeDetails.push(`attribute ${key} added`);
        } else if (currentVal.length === 0 && previousVal.length > 0) {
          changeDetails.push(`attribute ${key} removed`);
        } else {
          changeDetails.push(`attribute ${key} changed`);
        }
      }
    }

    // Check compound component changes (virtual components)
    const currentCompound = currentNode._compoundChildren || [];
    const previousCompound = previousNode._compoundChildren || [];

    if (currentCompound.length !== previousCompound.length) {
      changeDetails.push("compound children count changed");
    } else if (currentCompound.length > 0) {
      for (let i = 0; i < currentCompound.length; i++) {
        const currChild = currentCompound[i];
        const prevChild = previousCompound[i];

        // Deep comparison of compound children
        if (!this.deepEqual(currChild, prevChild)) {
          changeDetails.push(`compound child ${i} changed`);
        }
      }
    }

    // Check accessibility changes (critical for screen readers)
    if (!this.axNodesEqual(currentNode.axNode, previousNode.axNode)) {
      changeDetails.push("accessibility properties changed");
    }

    // Check visual changes (bounds, styles)
    if (currentNode.snapshotNode?.bounds && previousNode.snapshotNode?.bounds) {
      const currentBounds = currentNode.snapshotNode.bounds;
      const previousBounds = previousNode.snapshotNode.bounds;

      if (currentBounds.x !== previousBounds.x || currentBounds.y !== previousBounds.y) {
        changeDetails.push("position changed");
      }
      if (currentBounds.width !== previousBounds.width || currentBounds.height !== previousBounds.height) {
        changeDetails.push("size changed");
      }
    }

    const isChanged = changeDetails.length > 0;
    const changeType = previous ? "modified" : "new";

    return { isChanged, changeType, changeDetails };
  }

  /**
   * Enhanced change detection with additional analysis
   * Provides more context about the nature of changes
   */
  private enhanceChangeDetection(
    current: SimplifiedNode,
    previous: SimplifiedNode,
    changeResult: ChangeDetectionResult
  ): void {
    // This can be extended to add more sophisticated change analysis
    // For now, we'll just mark it as changed with the basic detection
    // Future enhancements could include:
    // - Change severity classification
    // - Change relevance scoring for AI agents
    // - Change clustering for related elements
    // - Change prediction for proactive updates
  }

  /**
   * Deep comparison utility for objects
   */
  private deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a == null || b == null) return false;
    if (typeof a !== typeof b) return false;

    if (typeof a === 'object') {
      const keysA = Object.keys(a as Record<string, unknown>);
      const keysB = Object.keys(b as Record<string, unknown>);

      if (keysA.length !== keysB.length) return false;

      for (const key of keysA) {
        if (!keysB.includes(key) || !this.deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) {
          return false;
        }
      }
      return true;
    }

    return false;
  }

  /**
   * Compare accessibility nodes for equality
   */
  private axNodesEqual(ax1: EnhancedAXNode | null | undefined, ax2: EnhancedAXNode | null | undefined): boolean {
    if (!ax1 && !ax2) return true;
    if (!ax1 || !ax2) return false;

    return (
      ax1.role === ax2.role &&
      ax1.name === ax2.name &&
      ax1.description === ax2.description &&
      ax1.ignored === ax2.ignored &&
      this.deepEqual(ax1.properties, ax2.properties)
    );
  }

  /**
   * Get duplicate nodes information (for debugging)
   */
  getDuplicateNodesInfo(): {
    hash: string;
    nodeIds: number[];
    count: number;
  }[] {
    const result: { hash: string; nodeIds: number[]; count: number }[] = [];

    for (const [hash, nodeIds] of this.duplicateNodeMap) {
      result.push({
        hash,
        nodeIds: [...nodeIds],
        count: nodeIds.length,
      });
    }

    return result.sort((a, b) => b.count - a.count);
  }

  /**
   * Clear all caches (useful for testing or memory management)
   */
  clearCaches(): void {
    this.nodeHashCache.clear();
    this.layoutIndexMap.clear();
    this.duplicateNodeMap.clear();
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
