/**
 * Unified DOM Tree Serializer - Simple single-pass processing
 *
 * Replaces the complex 6-stage pipeline with a straightforward approach
 * following browser-use patterns for maximum simplicity and maintainability.
 */

import type {
  EnhancedDOMTreeNode,
  SerializedDOMState,
  SimplifiedNode,
  DOMSelectorMap,
  SerializationConfig,
  SerializationStats
} from "@shared/dom";

// Simple interactive element tags
const INTERACTIVE_TAGS = [
  'button', 'input', 'select', 'textarea', 'a',
  'option', 'label', 'iframe', 'frame'
];

// Tags that should be skipped
const SKIP_TAGS = [
  'style', 'script', 'head', 'meta', 'link', 'title'
];

/**
 * Simplified timing info
 */
export interface SerializationTiming {
  serialize_dom_tree_total: number;
}

/**
 * Unified DOM Tree Serializer
 */
export class DOMTreeSerializer {
  private config: SerializationConfig;
  private interactiveCounter = 1;

  constructor(config: Partial<SerializationConfig> = {}) {
    this.config = {
      enablePaintOrderFiltering: true,
      enableBoundingBoxFiltering: true,
      enableCompoundComponents: false,
      opacityThreshold: 0.8,
      containmentThreshold: 0.99,
      maxInteractiveElements: 1000,
      ...config
    };
  }

  /**
   * Serialize DOM tree - single pass processing
   */
  async serializeDOMTree(
    rootNode: EnhancedDOMTreeNode,
    _previousState?: SerializedDOMState,
    _config?: Partial<SerializationConfig>
  ): Promise<{
    serializedState: SerializedDOMState;
    timing: SerializationTiming;
    stats: SerializationStats;
  }> {
    const startTime = Date.now();

    // Reset counter
    this.interactiveCounter = 1;

    // Single-pass serialization
    const simplifiedRoot = this.createSimplifiedNode(rootNode);
    if (!simplifiedRoot) {
      throw new Error("Root node was filtered out during serialization");
    }
    const selectorMap = this.buildSelectorMap(simplifiedRoot);
    const stats = this.calculateStats(simplifiedRoot);

    const timing = {
      serialize_dom_tree_total: Date.now() - startTime
    };

    return {
      serializedState: {
        root: simplifiedRoot,
        selectorMap
      },
      timing,
      stats
    };
  }

  /**
   * Create simplified node (single pass)
   */
  private createSimplifiedNode(node: EnhancedDOMTreeNode): SimplifiedNode | null {
    // Skip certain tags
    if (node.tag && SKIP_TAGS.includes(node.tag)) {
      return null;
    }

    // Skip hidden elements
    if (node.isVisible === false) {
      return null;
    }

    const simplified: SimplifiedNode = {
      originalNode: node,
      children: [],
      shouldDisplay: true,
      interactiveIndex: null,
      isNew: false,
      ignoredByPaintOrder: false,
      excludedByParent: false,
      isShadowHost: !!node.shadowRootType,
      isCompoundComponent: false,
      hasCompoundChildren: false,
      isLeaf: false,
      depth: 0,
      nodeHash: 0,
      interactiveElement: false,
      hasChildren: false,
      xpath: '',
      tagName: node.tag || '',
      textContent: node.nodeValue || ''
    };

    // Process children
    if (node.children) {
      for (const child of node.children) {
        const simplifiedChild = this.createSimplifiedNode(child);
        if (simplifiedChild) {
          simplified.children.push(simplifiedChild);
        }
      }
    }

    // Process shadow roots
    if (node.shadowRoots) {
      for (const shadowRoot of node.shadowRoots) {
        const simplifiedShadow = this.createSimplifiedNode(shadowRoot);
        if (simplifiedShadow) {
          simplified.children.push(simplifiedShadow);
        }
      }
    }

    // Check if interactive
    if (this.isInteractive(node) && simplified.shouldDisplay) {
      simplified.interactiveIndex = this.interactiveCounter++;
      simplified.interactiveElement = true;
    }

    // Add basic compound components
    this.addCompoundComponents(simplified, node);

    // Mark as new if no previous state
    simplified.isNew = true;

    return simplified;
  }

  /**
   * Check if element is interactive (simplified detection)
   */
  private isInteractive(node: EnhancedDOMTreeNode): boolean {
    if (!node.tag) return false;
    const tag = node.tag.toLowerCase();

    // Check interactive tags
    if (INTERACTIVE_TAGS.includes(tag)) {
      return true;
    }

    // Check for onclick handlers
    if (node.attributes?.onclick) {
      return true;
    }

    // Check ARIA roles
    if (node.attributes?.role) {
      const role = node.attributes.role.toLowerCase();
      if (['button', 'link', 'checkbox', 'radio', 'tab', 'menuitem'].includes(role)) {
        return true;
      }
    }

    // Check for input-like attributes
    if (node.attributes?.contenteditable === 'true') {
      return true;
    }

    // Check accessibility properties
    if (node.axNode?.properties) {
      for (const prop of node.axNode.properties) {
        if (prop.name === 'focusable' && prop.value === true) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Add basic compound components (simplified)
   */
  private addCompoundComponents(simplified: SimplifiedNode, node: EnhancedDOMTreeNode): void {
    if (!node.tag) return;
    const tag = node.tag.toLowerCase();
    const type = node.attributes?.type?.toLowerCase();

    // Date input
    if (tag === 'input' && ['date', 'time', 'datetime-local', 'month'].includes(type || '')) {
      simplified.isCompoundComponent = true;
      node._compoundChildren = [
        { role: 'spinbutton', name: 'Day', valuemin: 1, valuemax: 31 },
        { role: 'spinbutton', name: 'Month', valuemin: 1, valuemax: 12 }
      ];
    }

    // Range input
    if (tag === 'input' && type === 'range') {
      simplified.isCompoundComponent = true;
      node._compoundChildren = [
        { role: 'slider', name: 'Value', valuemin: 0, valuemax: 100 }
      ];
    }

    // Number input
    if (tag === 'input' && type === 'number') {
      simplified.isCompoundComponent = true;
      node._compoundChildren = [
        { role: 'button', name: 'Increment' },
        { role: 'button', name: 'Decrement' },
        { role: 'textbox', name: 'Value' }
      ];
    }

    // Select dropdown
    if (tag === 'select') {
      simplified.isCompoundComponent = true;
      node._compoundChildren = [
        { role: 'button', name: 'Dropdown Toggle' },
        { role: 'listbox', name: 'Options' }
      ];
    }

    // File input
    if (tag === 'input' && type === 'file') {
      simplified.isCompoundComponent = true;
      node._compoundChildren = [
        { role: 'button', name: 'Browse Files' },
        { role: 'textbox', name: 'Files Selected' }
      ];
    }
  }

  /**
   * Build selector map for interactive elements
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
    let interactiveElements = 0;
    let newElements = 0;

    const traverse = (node: SimplifiedNode) => {
      totalNodes++;

      if (node.interactiveIndex !== null) {
        interactiveElements++;
      }

      if (node.isNew) {
        newElements++;
      }

      for (const child of node.children) {
        traverse(child);
      }
    };

    traverse(root);

    return {
      totalNodes,
      simplifiedNodes: totalNodes,
      filteredNodes: 0,
      interactiveElements,
      newElements,
      occludedNodes: 0,
      containedNodes: 0,
      compoundComponents: 0
    };
  }

  /**
   * Get current configuration
   */
  getConfig(): SerializationConfig {
    return this.config;
  }
}