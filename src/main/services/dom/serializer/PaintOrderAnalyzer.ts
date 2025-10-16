/**
 * Paint Order Analyzer - Occlusion filtering with RectUnionPure
 *
 * Advanced paint order processing that removes occluded elements using
 * geometric rectangle calculations following browser-use patterns.
 */

import type { EnhancedDOMTreeNode, SimplifiedNode } from "@shared/dom";

/**
 * Rectangle with geometric operations for paint order analysis
 */
class Rect {
  constructor(
    public readonly x1: number, // bottom-left
    public readonly y1: number,
    public readonly x2: number, // top-right
    public readonly y2: number
  ) {}

  /**
   * Get rectangle area
   */
  get area(): number {
    return Math.max(0, this.x2 - this.x1) * Math.max(0, this.y2 - this.y1);
  }

  /**
   * Check if two rectangles intersect
   */
  intersects(other: Rect): boolean {
    return !(this.x2 <= other.x1 || other.x2 <= this.x1 ||
             this.y2 <= other.y1 || other.y2 <= this.y1);
  }

  /**
   * Check if this rectangle contains another
   */
  contains(other: Rect): boolean {
    return this.x1 <= other.x1 && this.y1 <= other.y1 &&
           this.x2 >= other.x2 && this.y2 >= other.y2;
  }

  /**
   * Get the intersection of two rectangles
   */
  intersection(other: Rect): Rect | null {
    if (!this.intersects(other)) return null;

    return new Rect(
      Math.max(this.x1, other.x1),
      Math.max(this.y1, other.y1),
      Math.min(this.x2, other.x2),
      Math.min(this.y2, other.y2)
    );
  }

  /**
   * Check if rectangle is valid (has positive area)
   */
  isValid(): boolean {
    return this.x2 > this.x1 && this.y2 > this.y1;
  }

  /**
   * Expand rectangle by given amount
   */
  expand(amount: number): Rect {
    return new Rect(
      this.x1 - amount,
      this.y1 - amount,
      this.x2 + amount,
      this.y2 + amount
    );
  }

  /**
   * Convert to string representation
   */
  toString(): string {
    return `Rect(${this.x1.toFixed(1)}, ${this.y1.toFixed(1)}, ${this.x2.toFixed(1)}, ${this.y2.toFixed(1)})`;
  }
}

/**
 * Pure rectangle union implementation for paint order analysis
 *
 * Maintains a set of disjoint rectangles and provides efficient operations
 * for checking if new rectangles are covered by the union.
 */
class RectUnionPure {
  private rects: Rect[] = [];

  /**
   * Check if a rectangle is completely covered by the union
   */
  contains(rect: Rect): boolean {
    // Check if rect is already covered by any existing rectangle
    for (const existing of this.rects) {
      if (existing.contains(rect)) {
        return true;
      }
    }

    // Check if rect can be covered by combining existing rectangles
    // This is a simplified implementation - full coverage detection is complex
    const totalCoveredArea = this.calculateCoveredArea(rect);
    return totalCoveredArea >= rect.area * 0.95; // 95% coverage threshold
  }

  /**
   * Add a rectangle to the union
   * Returns true if the rectangle was added (not fully covered)
   */
  add(rect: Rect): boolean {
    if (!rect.isValid()) return false;

    // If already covered, don't add
    if (this.contains(rect)) {
      return false;
    }

    // Remove any rectangles that are covered by the new rectangle
    this.rects = this.rects.filter(existing => !rect.contains(existing));

    // Split existing rectangles that intersect with the new rectangle
    const newRects: Rect[] = [];
    for (const existing of this.rects) {
      if (existing.intersects(rect)) {
        // Split the existing rectangle around the new one
        const splitRects = this.splitRect(existing, rect);
        newRects.push(...splitRects);
      } else {
        newRects.push(existing);
      }
    }

    // Add the new rectangle
    newRects.push(rect);
    this.rects = this.mergeOverlappingRects(newRects);

    return true;
  }

  /**
   * Calculate the area of a rectangle that's covered by the union
   */
  private calculateCoveredArea(rect: Rect): number {
    let coveredArea = 0;

    for (const existing of this.rects) {
      const intersection = rect.intersection(existing);
      if (intersection) {
        coveredArea += intersection.area;
      }
    }

    return coveredArea;
  }

  /**
   * Split a rectangle around another rectangle
   * Returns the parts of 'original' that don't intersect with 'exclude'
   */
  private splitRect(original: Rect, exclude: Rect): Rect[] {
    if (!original.intersects(exclude)) {
      return [original];
    }

    const result: Rect[] = [];

    // Left strip
    if (original.x1 < exclude.x1) {
      result.push(new Rect(original.x1, original.y1, exclude.x1, original.y2));
    }

    // Right strip
    if (original.x2 > exclude.x2) {
      result.push(new Rect(exclude.x2, original.y1, original.x2, original.y2));
    }

    // Bottom strip
    if (original.y1 < exclude.y1) {
      result.push(new Rect(
        Math.max(original.x1, exclude.x1),
        original.y1,
        Math.min(original.x2, exclude.x2),
        exclude.y1
      ));
    }

    // Top strip
    if (original.y2 > exclude.y2) {
      result.push(new Rect(
        Math.max(original.x1, exclude.x1),
        exclude.y2,
        Math.min(original.x2, exclude.x2),
        original.y2
      ));
    }

    return result.filter(rect => rect.isValid());
  }

  /**
   * Merge overlapping rectangles to optimize the union
   */
  private mergeOverlappingRects(rects: Rect[]): Rect[] {
    const merged: Rect[] = [];
    const used = new Set<number>();

    for (let i = 0; i < rects.length; i++) {
      if (used.has(i)) continue;

      let current = rects[i];
      used.add(i);

      // Try to merge with others
      for (let j = i + 1; j < rects.length; j++) {
        if (used.has(j)) continue;

        const other = rects[j];

        // Simple merge for rectangles that can be combined
        const mergedRect = this.tryMerge(current, other);
        if (mergedRect) {
          current = mergedRect;
          used.add(j);
          i = -1; // Restart merging
          break;
        }
      }

      merged.push(current);
    }

    return merged;
  }

  /**
   * Try to merge two rectangles if they can be combined
   */
  private tryMerge(rect1: Rect, rect2: Rect): Rect | null {
    // Check if rectangles are aligned and can be merged
    // This is a simplified implementation

    // Horizontal merge (same y coordinates, touching x coordinates)
    if (Math.abs(rect1.y1 - rect2.y1) < 1 && Math.abs(rect1.y2 - rect2.y2) < 1) {
      if (Math.abs(rect1.x2 - rect2.x1) < 1) {
        return new Rect(rect1.x1, rect1.y1, rect2.x2, rect2.y2);
      }
      if (Math.abs(rect2.x2 - rect1.x1) < 1) {
        return new Rect(rect2.x1, rect2.y1, rect1.x2, rect1.y2);
      }
    }

    // Vertical merge (same x coordinates, touching y coordinates)
    if (Math.abs(rect1.x1 - rect2.x1) < 1 && Math.abs(rect1.x2 - rect2.x2) < 1) {
      if (Math.abs(rect1.y2 - rect2.y1) < 1) {
        return new Rect(rect1.x1, rect1.y1, rect2.x2, rect2.y2);
      }
      if (Math.abs(rect2.y2 - rect1.y1) < 1) {
        return new Rect(rect2.x1, rect2.y1, rect1.x2, rect1.y2);
      }
    }

    return null;
  }

  /**
   * Get current rectangle count
   */
  get size(): number {
    return this.rects.length;
  }

  /**
   * Get all rectangles in the union
   */
  getRectangles(): Rect[] {
    return [...this.rects];
  }

  /**
   * Clear the union
   */
  clear(): void {
    this.rects = [];
  }
}

/**
 * Paint order analyzer for occlusion filtering
 */
export class PaintOrderAnalyzer {
  private readonly rectUnion: RectUnionPure;
  private readonly opacityThreshold: number;
  private readonly enableTransparencyFiltering: boolean;

  constructor(options: {
    opacityThreshold?: number;
    enableTransparencyFiltering?: boolean;
  } = {}) {
    this.rectUnion = new RectUnionPure();
    this.opacityThreshold = options.opacityThreshold ?? 0.8;
    this.enableTransparencyFiltering = options.enableTransparencyFiltering ?? true;
  }

  /**
   * Filter nodes based on paint order and occlusion
   * Returns array of nodes that should be kept (not occluded)
   */
  filterNodes(nodes: SimplifiedNode[]): SimplifiedNode[] {
    // Clear previous state
    this.rectUnion.clear();

    // Sort nodes by paint order (highest to lowest)
    const sortedNodes = this.sortByPaintOrder(nodes);

    const visibleNodes: SimplifiedNode[] = [];
  
    // Process nodes from highest to lowest paint order
    for (const node of sortedNodes) {
      if (this.shouldFilterNode(node)) {
        node.ignoredByPaintOrder = true;
        } else {
        node.ignoredByPaintOrder = false;
        visibleNodes.push(node);

        // Add node's bounds to the union for subsequent occlusion checks
        const bounds = this.getNodeBounds(node);
        if (bounds) {
          this.rectUnion.add(bounds);
        }
      }
    }

    return visibleNodes;
  }

  /**
   * Check if a specific node should be filtered out
   */
  private shouldFilterNode(node: SimplifiedNode): boolean {
    // Skip nodes without bounds
    if (!node.shouldDisplay) {
      return true;
    }

    const bounds = this.getNodeBounds(node);
    if (!bounds) {
      return true;
    }

    // Check transparency filtering
    if (this.enableTransparencyFiltering && this.isTransparentNode(node)) {
      return true;
    }

    // Check for exceptions (nodes that should never be filtered)
    if (this.isExceptionNode(node)) {
      return false;
    }

    // Check if already occluded by higher paint order elements
    return this.rectUnion.contains(bounds);
  }

  /**
   * Sort nodes by paint order (highest first)
   */
  private sortByPaintOrder(nodes: SimplifiedNode[]): SimplifiedNode[] {
    return [...nodes].sort((a, b) => {
      const aPaintOrder = a.originalNode.snapshotNode?.paintOrder ?? 0;
      const bPaintOrder = b.originalNode.snapshotNode?.paintOrder ?? 0;

      // Higher paint order comes first
      if (aPaintOrder !== bPaintOrder) {
        return bPaintOrder - aPaintOrder;
      }

      // If paint order is the same, sort by DOM order
      const aDomOrder = a.originalNode.nodeId;
      const bDomOrder = b.originalNode.nodeId;
      return aDomOrder - bDomOrder;
    });
  }

  /**
   * Get bounding rectangle for a node
   */
  private getNodeBounds(node: SimplifiedNode): Rect | null {
    const bounds = node.originalNode.snapshotNode?.bounds;
    if (!bounds) return null;

    return new Rect(
      bounds.x,
      bounds.y,
      bounds.x + bounds.width,
      bounds.y + bounds.height
    );
  }

  /**
   * Check if node is transparent and should be filtered
   */
  private isTransparentNode(node: SimplifiedNode): boolean {
    const snapshotNode = node.originalNode.snapshotNode;
    if (!snapshotNode) return false;

    // Check computed styles for transparency
    const computedStyles = snapshotNode.computedStyles;
    if (computedStyles) {
      // Check opacity
      const opacity = parseFloat(computedStyles.opacity || '1');
      if (opacity < this.opacityThreshold) {
        return true;
      }

      // Check for transparent background
      const backgroundColor = computedStyles['background-color'];
      if (!backgroundColor ||
          backgroundColor === 'transparent' ||
          backgroundColor === 'rgba(0, 0, 0, 0)') {

        // If element has no text content and no background, it might be invisible
        if (this.hasNoVisibleContent(node)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Check if node has no visible content
   */
  private hasNoVisibleContent(node: SimplifiedNode): boolean {
    const originalNode = node.originalNode;

    // If node has text content, it's visible
    if (originalNode.nodeValue && originalNode.nodeValue.trim().length > 0) {
      return false;
    }

    // If node has meaningful accessible name, it's visible
    if (originalNode.axNode?.name && originalNode.axNode.name.trim().length > 0) {
      return false;
    }

    // If node has children, it might be a container
    if (node.children.length > 0) {
      return false;
    }

    return true;
  }

  /**
   * Check if node is an exception that should never be filtered
   */
  private isExceptionNode(node: SimplifiedNode): boolean {
    const originalNode = node.originalNode;

    // Interactive elements are exceptions
    const { isInteractive } = this.isInteractiveNode(originalNode);
    if (isInteractive) {
      return true;
    }

    // Scrollable containers are exceptions
    if (originalNode.isActuallyScrollable) {
      return true;
    }

    // Elements with accessible name are exceptions
    if (originalNode.axNode?.name && originalNode.axNode.name.trim().length > 0) {
      return true;
    }

    return false;
  }

  /**
   * Quick interactivity check (simplified version for exceptions)
   */
  private isInteractiveNode(node: EnhancedDOMTreeNode): { isInteractive: boolean } {
    // Basic check for interactive attributes
    if (node.elementIndex !== null && node.elementIndex !== undefined && node.elementIndex >= 0) {
      return { isInteractive: true };
    }

    // Check for interactive cursor
    if (node.snapshotNode?.cursorStyle === 'pointer') {
      return { isInteractive: true };
    }

    // Check for interactive tags
    const interactiveTags = ['button', 'input', 'select', 'textarea', 'a'];
    if (node.tag && interactiveTags.includes(node.tag.toLowerCase())) {
      return { isInteractive: true };
    }

    // Check for interactive ARIA role
    if (node.axNode?.role) {
      const interactiveRoles = ['button', 'link', 'menuitem', 'option', 'tab'];
      if (interactiveRoles.includes(node.axNode.role.toLowerCase())) {
        return { isInteractive: true };
      }
    }

    return { isInteractive: false };
  }

  /**
   * Get paint order analysis statistics
   */
  getStats(): {
    totalNodes: number;
    visibleNodes: number;
    occludedNodes: number;
    filterRate: number;
    unionRectCount: number;
  } {
    const totalNodes = this.rectUnion.size;

    return {
      totalNodes,
      visibleNodes: totalNodes,
      occludedNodes: 0, // This would be tracked during filterNodes
      filterRate: 0, // This would be calculated during filterNodes
      unionRectCount: this.rectUnion.size
    };
  }
}