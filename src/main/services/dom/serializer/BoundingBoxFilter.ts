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
  private readonly PROPAGATING_ELEMENTS: ElementPattern[] = [
    { tag: 'a' },
    { tag: 'button' },
    { tag: 'div', role: 'button' },
    { tag: 'div', role: 'combobox' },
    { tag: 'span', role: 'button' },
    { tag: 'span', role: 'link' },
    { tag: 'input', role: 'combobox' },
    { tag: 'li' },
    { tag: 'tr' },
    { tag: 'td' },
    { tag: 'th' }
  ];

  // Elements that are exceptions to bounding box filtering
  private readonly EXCEPTION_ELEMENTS: ElementPattern[] = [
    // Form elements
    { tag: 'input' },
    { tag: 'select' },
    { tag: 'textarea' },
    { tag: 'button' },
    { tag: 'label' },
    // Interactive elements
    { tag: 'a' },
    { tag: 'iframe' },
    { tag: 'canvas' },
    { tag: 'video' },
    { tag: 'audio' },
    // Elements with interactive roles
    { tag: 'div', role: 'button' },
    { tag: 'div', role: 'combobox' },
    { tag: 'div', role: 'link' },
    { tag: 'div', role: 'menuitem' },
    { tag: 'span', role: 'button' },
    { tag: 'span', role: 'link' }
  ];

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
   */
  private shouldExcludeChild(child: SimplifiedNode, _parentBounds: PropagatingBounds): boolean {
    const originalNode = child.originalNode;

    // Exception 1: Interactive elements
    if (this.isInteractiveException(child)) {
      return false;
    }

    // Exception 2: Elements with accessibility properties
    if (this.hasAccessibilityProperties(originalNode)) {
      return false;
    }

    // Exception 3: Elements with explicit event handlers
    if (this.hasEventHandlers(originalNode)) {
      return false;
    }

    // Exception 4: Elements with meaningful names
    if (this.hasMeaningfulName(originalNode)) {
      return false;
    }

    // Exception 5: Compound components
    if (child.isCompoundComponent) {
      return false;
    }

    // Exception 6: Shadow hosts
    if (child.isShadowHost) {
      return false;
    }

    // Exception 7: Form controls
    if (this.isFormControl(originalNode)) {
      return false;
    }

    // Exception 8: Media elements
    if (this.isMediaElement(originalNode)) {
      return false;
    }

    // Exception 9: Iframe elements
    if (originalNode.tag === 'iframe') {
      return false;
    }

    // Default: exclude child if contained
    return true;
  }

  /**
   * Check if node should propagate bounds to children
   */
  private shouldPropagateBounds(node: SimplifiedNode): boolean {
    const originalNode = node.originalNode;

    for (const pattern of this.PROPAGATING_ELEMENTS) {
      if (this.matchesPattern(originalNode, pattern)) {
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