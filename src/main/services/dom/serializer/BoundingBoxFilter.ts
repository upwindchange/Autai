/**
 * Bounding Box Filter - Propagating bounds with exception rules
 *
 * Advanced bounding box filtering that removes nested elements contained
 * within their parents, with comprehensive exception rules for important elements.
 */

import type { EnhancedDOMTreeNode, SimplifiedNode } from "@shared/dom";

/**
 * Propagating bounds information
 */
interface PropagatingBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  node: SimplifiedNode;
}

/**
 * Bounding box filtering configuration
 */
interface BoundingBoxFilterConfig {
  containmentThreshold: number;
  enableSizeFiltering: boolean;
  minElementSize: number;
  maxElementSize: number;
}

/**
 * Element patterns that propagate bounds to their children
 */
interface ElementPattern {
  tag: string;
  role?: string;
  hasAttribute?: string;
}

/**
 * Bounding box filter with propagating bounds and exception rules
 */
export class BoundingBoxFilter {
  private readonly config: BoundingBoxFilterConfig;

  // Elements that propagate bounds to their children
  // Matching browser-use reference exactly
  private readonly PROPAGATING_ELEMENTS: ElementPattern[] = [
    { tag: 'a' }, // Any <a> tag
    { tag: 'button' }, // Any <button> tag
    { tag: 'div', role: 'button' }, // <div role="button">
    { tag: 'div', role: 'combobox' }, // <div role="combobox"> - dropdowns/selects
    { tag: 'span', role: 'button' }, // <span role="button">
    { tag: 'span', role: 'combobox' }, // <span role="combobox">
    { tag: 'input', role: 'combobox' }, // <input role="combobox"> - autocomplete inputs
    { tag: 'input', role: 'combobox' } // <input type="text"> - text inputs with suggestions (duplicate for reference compatibility)
  ];

  // Elements that are exceptions to bounding box filtering
  // These are handled in shouldExcludeChild() method following browser-use reference patterns

  constructor(config: Partial<BoundingBoxFilterConfig> = {}) {
    this.config = {
      containmentThreshold: 0.99,
      enableSizeFiltering: true,
      minElementSize: 5,
      maxElementSize: 10000,
      ...config
    };
  }

  /**
   * Apply bounding box filtering to tree
   */
  filterTree(root: SimplifiedNode): {
    filteredCount: number;
    retainedCount: number;
  } {
    const stats = {
      filteredCount: 0,
      retainedCount: 0
    };

    this.applyBoundingBoxFiltering(root, null, stats);

    return stats;
  }

  /**
   * Apply bounding box filtering recursively
   */
  private applyBoundingBoxFiltering(
    node: SimplifiedNode,
    _parentBounds: PropagatingBounds | null,
    stats: { filteredCount: number; retainedCount: number }
  ): PropagatingBounds | null {
    // Get current node bounds
    const currentBounds = this.getNodeBounds(node);

    // Check if current node is contained within parent bounds
    if (_parentBounds && currentBounds && this.isContainedByParent(currentBounds, _parentBounds)) {
      if (this.shouldExcludeChild(node, _parentBounds)) {
        node.excludedByParent = true;
        stats.filteredCount++;
        return null;
      }
    }

    // Determine if this node propagates bounds
    const propagatesBounds = this.shouldPropagateBounds(node);
    let activeBounds: PropagatingBounds | null = null;

    if (propagatesBounds && currentBounds) {
      activeBounds = {
        x: currentBounds.x,
        y: currentBounds.y,
        width: currentBounds.width,
        height: currentBounds.height,
        node
      };
    } else if (_parentBounds && !propagatesBounds) {
      activeBounds = _parentBounds;
    }

    // Process children
    const filteredChildren: SimplifiedNode[] = [];
    for (const child of node.children) {
      this.applyBoundingBoxFiltering(child, activeBounds, stats);

      if (!child.excludedByParent) {
        filteredChildren.push(child);
        stats.retainedCount++;
      }
    }

    node.children = filteredChildren;

    // Apply size filtering
    if (this.config.enableSizeFiltering && currentBounds) {
      if (this.shouldFilterBySize(currentBounds)) {
        node.excludedByParent = true;
        stats.filteredCount++;
        return null;
      }
    }

    return activeBounds;
  }

  /**
   * Get bounding rectangle for a node
   */
  private getNodeBounds(node: SimplifiedNode): { x: number; y: number; width: number; height: number } | null {
    const bounds = node.originalNode.snapshotNode?.bounds;
    if (!bounds) return null;

    return {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height
    };
  }

  /**
   * Check if node bounds are contained within parent bounds
   */
  private isContainedByParent(
    childBounds: { x: number; y: number; width: number; height: number },
    parentBounds: PropagatingBounds
  ): boolean {
    const childArea = childBounds.width * childBounds.height;
    const parentArea = parentBounds.width * parentBounds.height;

    if (childArea === 0 || parentArea === 0) {
      return false;
    }

    // Calculate overlap
    const overlapX = Math.max(0, Math.min(childBounds.x + childBounds.width, parentBounds.x + parentBounds.width) - Math.max(childBounds.x, parentBounds.x));
    const overlapY = Math.max(0, Math.min(childBounds.y + childBounds.height, parentBounds.y + parentBounds.height) - Math.max(childBounds.y, parentBounds.y));
    const overlapArea = overlapX * overlapY;

    // Check containment based on threshold
    const containmentRatio = overlapArea / childArea;
    return containmentRatio >= this.config.containmentThreshold;
  }

  /**
   * Check if child should be excluded based on exception rules
   * Matches browser-use reference exactly
   */
  private shouldExcludeChild(child: SimplifiedNode, activeBounds: PropagatingBounds): boolean {
    const originalNode = child.originalNode;

    // Never exclude text nodes - we always want to preserve text content
    if (originalNode.nodeType === 3) { // TEXT_NODE
      return false;
    }

    // Get child bounds
    if (!originalNode.snapshotNode || !originalNode.snapshotNode.bounds) {
      return false; // No bounds = can't determine containment
    }

    const childBounds = originalNode.snapshotNode.bounds;

    // Check containment with configured threshold
    if (!this.isContained(childBounds, activeBounds.bounds)) {
      return false; // Not sufficiently contained
    }

    // EXCEPTION RULES - Keep these even if contained:

    const childTag = originalNode.tag?.toLowerCase() || '';
    const childRole = originalNode.attributes?.role || null;

    // 1. Never exclude form elements (they need individual interaction)
    if (['input', 'select', 'textarea', 'label'].includes(childTag)) {
      return false;
    }

    // 2. Keep if child is also a propagating element
    // (might have stopPropagation, e.g., button in button)
    if (this.isPropagatingElement(child)) {
      return false;
    }

    // 3. Keep if has explicit onclick handler
    if (originalNode.attributes && 'onclick' in originalNode.attributes) {
      return false;
    }

    // 4. Keep if has aria-label suggesting it's independently interactive
    if (originalNode.attributes) {
      const ariaLabel = originalNode.attributes['aria-label'];
      if (ariaLabel && ariaLabel.trim()) {
        // Has meaningful aria-label, likely interactive
        return false;
      }
    }

    // 5. Keep if has role suggesting interactivity
    if (originalNode.attributes) {
      const role = originalNode.attributes.get('role');
      if (['button', 'link', 'checkbox', 'radio', 'tab', 'menuitem', 'option'].includes(role || '')) {
        return false;
      }
    }

    // Default: exclude this child
    return true;
  }

  /**
   * Check if node should propagate bounds to children
   * Matches browser-use reference exactly
   */
  private shouldPropagateBounds(node: SimplifiedNode): boolean {
    const originalNode = node.originalNode;
    const tag = originalNode.tag?.toLowerCase() || '';
    const role = originalNode.attributes?.role || null;
    const attributes = {
      tag,
      role,
    };

    return this.isPropagatingElement(attributes);
  }

  /**
   * Check if an element should propagate bounds based on attributes
   * Matches browser-use reference exactly
   */
  private isPropagatingElement(attributes: { tag: string; role: string | null }): boolean {
    for (const pattern of this.PROPAGATING_ELEMENTS) {
      // Check if the element satisfies the pattern
      const tagMatch = pattern.tag === null || pattern.tag === attributes.tag;
      const roleMatch = pattern.role === null || pattern.role === attributes.role;

      if (tagMatch && roleMatch) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if node matches an element pattern
   */
  private matchesPattern(originalNode: EnhancedDOMTreeNode, pattern: ElementPattern): boolean {
    // Check tag
    if (pattern.tag && originalNode.tag?.toLowerCase() !== pattern.tag.toLowerCase()) {
      return false;
    }

    // Check role
    if (pattern.role && originalNode.axNode?.role?.toLowerCase() !== pattern.role.toLowerCase()) {
      return false;
    }

    // Check attribute
    if (pattern.hasAttribute && !(pattern.hasAttribute in originalNode.attributes)) {
      return false;
    }

    return true;
  }

  /**
   * Check if node is an interactive exception
   */
  private isInteractiveException(node: SimplifiedNode): boolean {
    const originalNode = node.originalNode;

    for (const pattern of this.EXCEPTION_ELEMENTS) {
      if (this.matchesPattern(originalNode, pattern)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if node has accessibility properties
   */
  private hasAccessibilityProperties(originalNode: EnhancedDOMTreeNode): boolean {
    if (!originalNode.axNode) return false;

    // Check for meaningful role
    if (originalNode.axNode.role && originalNode.axNode.role !== 'generic') {
      return true;
    }

    // Check for meaningful name
    if (originalNode.axNode.name && originalNode.axNode.name.trim().length > 0) {
      return true;
    }

    // Check for interactive accessibility properties
    if (originalNode.axNode.properties) {
      for (const prop of originalNode.axNode.properties) {
        switch (prop.name) {
          case 'focusable':
          case 'editable':
          case 'settable':
          case 'checked':
          case 'selected':
          case 'haspopup':
          case 'required':
            if (prop.value === true) {
              return true;
            }
            break;
        }
      }
    }

    return false;
  }

  /**
   * Check if node has event handlers
   */
  private hasEventHandlers(originalNode: EnhancedDOMTreeNode): boolean {
    const eventHandlers = [
      'onclick', 'onmousedown', 'onmouseup', 'onmouseover', 'onmouseout',
      'onkeydown', 'onkeyup', 'onkeypress', 'ontouchstart', 'ontouchend',
      'onsubmit', 'onchange', 'oninput', 'onfocus', 'onblur'
    ];

    for (const handler of eventHandlers) {
      if (originalNode.attributes[handler]) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if node has a meaningful name
   */
  private hasMeaningfulName(originalNode: EnhancedDOMTreeNode): boolean {
    // Check aria-label
    if (originalNode.attributes['aria-label'] &&
        originalNode.attributes['aria-label'].trim().length > 0) {
      return true;
    }

    // Check title
    if (originalNode.attributes.title &&
        originalNode.attributes.title.trim().length > 0) {
      return true;
    }

    // Check accessibility name
    if (originalNode.axNode?.name &&
        originalNode.axNode.name.trim().length > 0) {
      return true;
    }

    return false;
  }

  /**
   * Check if node is a form control
   */
  private isFormControl(originalNode: EnhancedDOMTreeNode): boolean {
    const formTags = ['input', 'select', 'textarea', 'button', 'option', 'label'];
    return originalNode.tag ? formTags.includes(originalNode.tag.toLowerCase()) : false;
  }

  /**
   * Check if node is a media element
   */
  private isMediaElement(originalNode: EnhancedDOMTreeNode): boolean {
    const mediaTags = ['video', 'audio', 'canvas', 'svg'];
    return originalNode.tag ? mediaTags.includes(originalNode.tag.toLowerCase()) : false;
  }

  /**
   * Check if node should be filtered based on size
   */
  private shouldFilterBySize(bounds: { x: number; y: number; width: number; height: number }): boolean {
    const area = bounds.width * bounds.height;

    // Filter very small elements
    if (area < this.config.minElementSize * this.config.minElementSize) {
      return true;
    }

    // Filter extremely large elements (likely page containers)
    if (area > this.config.maxElementSize * this.config.maxElementSize) {
      return true;
    }

    // Filter elements with zero width or height
    if (bounds.width <= 0 || bounds.height <= 0) {
      return true;
    }

    return false;
  }

  /**
   * Get filtering statistics
   */
  getFilteringStats(root: SimplifiedNode): {
    totalNodes: number;
    excludedNodes: number;
    propagatingNodes: number;
    interactiveExceptions: number;
    sizeFiltered: number;
  } {
    let totalNodes = 0;
    let excludedNodes = 0;
    let propagatingNodes = 0;
    let interactiveExceptions = 0;
    let sizeFiltered = 0;

    const traverse = (node: SimplifiedNode) => {
      totalNodes++;

      if (node.excludedByParent) {
        excludedNodes++;
      }

      if (this.shouldPropagateBounds(node)) {
        propagatingNodes++;
      }

      if (this.isInteractiveException(node)) {
        interactiveExceptions++;
      }

      const bounds = this.getNodeBounds(node);
      if (bounds && this.shouldFilterBySize(bounds)) {
        sizeFiltered++;
      }

      for (const child of node.children) {
        traverse(child);
      }
    };

    traverse(root);

    return {
      totalNodes,
      excludedNodes,
      propagatingNodes,
      interactiveExceptions,
      sizeFiltered
    };
  }

  /**
   * Configure filtering parameters
   */
  updateConfig(newConfig: Partial<BoundingBoxFilterConfig>): void {
    Object.assign(this.config, newConfig);
  }

  /**
   * Get current configuration
   */
  getConfig(): BoundingBoxFilterConfig {
    return { ...this.config };
  }

  /**
   * Add custom propagating element pattern
   */
  addPropagatingPattern(pattern: ElementPattern): void {
    this.PROPAGATING_ELEMENTS.push(pattern);
  }

  /**
   * Add custom exception pattern
   */
  addExceptionPattern(pattern: ElementPattern): void {
    this.EXCEPTION_ELEMENTS.push(pattern);
  }
}