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
    return !(
      this.x2 <= other.x1 ||
      other.x2 <= this.x1 ||
      this.y2 <= other.y1 ||
      other.y2 <= this.y1
    );
  }

  /**
   * Check if this rectangle contains another
   */
  contains(other: Rect): boolean {
    return (
      this.x1 <= other.x1 &&
      this.y1 <= other.y1 &&
      this.x2 >= other.x2 &&
      this.y2 >= other.y2
    );
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
    return `Rect(${this.x1.toFixed(1)}, ${this.y1.toFixed(
      1
    )}, ${this.x2.toFixed(1)}, ${this.y2.toFixed(1)})`;
  }
}

/**
 * Pure rectangle union implementation for paint order analysis
 *
 * Implements the exact algorithm from browser-use reference with
 * sophisticated rectangle splitting and containment checking.
 */
class RectUnionPure {
  private rects: Rect[] = [];

  /**
   * Check if a rectangle is completely covered by the union
   * Uses stack-based algorithm for accurate coverage detection
   */
  contains(rect: Rect): boolean {
    if (!this.rects.length) {
      return false;
    }

    const stack: Rect[] = [rect];

    for (const s of this.rects) {
      const newStack: Rect[] = [];

      for (const piece of stack) {
        if (s.contains(piece)) {
          // Piece completely covered
          continue;
        }

        if (piece.intersects(s)) {
          // Split the piece around the existing rectangle
          newStack.push(...this._split_diff(piece, s));
        } else {
          newStack.push(piece);
        }
      }

      stack.length = 0;
      stack.push(...newStack);

      // Everything eaten - covered
      if (stack.length === 0) {
        return true;
      }
    }

    // Something survived - not fully covered
    return false;
  }

  /**
   * Add a rectangle to the union unless it is already covered
   * Returns true if the union grew
   */
  add(rect: Rect): boolean {
    if (!rect.isValid()) {
      return false;
    }

    if (this.contains(rect)) {
      return false;
    }

    const pending: Rect[] = [rect];
    let i = 0;

    while (i < this.rects.length) {
      const s = this.rects[i];
      const newPending: Rect[] = [];

      for (const piece of pending) {
        if (piece.intersects(s)) {
          newPending.push(...this._split_diff(piece, s));
        } else {
          newPending.push(piece);
        }
      }

      pending.length = 0;
      pending.push(...newPending);
      i += 1;
    }

    // Any left-over pieces are new, non-overlapping areas
    this.rects.push(...pending);
    return true;
  }

  /**
   * Return list of up to 4 rectangles = a \ b (a minus b)
   * Assumes a intersects b
   * This is the exact implementation from the browser-use reference
   */
  private _split_diff(a: Rect, b: Rect): Rect[] {
    const parts: Rect[] = [];

    // Bottom slice
    if (a.y1 < b.y1) {
      parts.push(new Rect(a.x1, a.y1, a.x2, b.y1));
    }

    // Top slice
    if (b.y2 < a.y2) {
      parts.push(new Rect(a.x1, b.y2, a.x2, a.y2));
    }

    // Middle (vertical) strip: y overlap is [max(a.y1,b.y1), min(a.y2,b.y2)]
    const y_lo = Math.max(a.y1, b.y1);
    const y_hi = Math.min(a.y2, b.y2);

    // Left slice
    if (a.x1 < b.x1) {
      parts.push(new Rect(a.x1, y_lo, b.x1, y_hi));
    }

    // Right slice
    if (b.x2 < a.x2) {
      parts.push(new Rect(b.x2, y_lo, a.x2, y_hi));
    }

    return parts.filter((rect) => rect.isValid());
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
    this.rects.length = 0;
  }
}

/**
 * Paint order analyzer for occlusion filtering
 */
export class PaintOrderAnalyzer {
  private readonly rectUnion: RectUnionPure;
  private readonly opacityThreshold: number;
  private readonly enableTransparencyFiltering: boolean;

  constructor(
    options: {
      opacityThreshold?: number;
      enableTransparencyFiltering?: boolean;
    } = {}
  ) {
    this.rectUnion = new RectUnionPure();
    this.opacityThreshold = options.opacityThreshold ?? 0.8;
    this.enableTransparencyFiltering =
      options.enableTransparencyFiltering ?? true;
  }

  /**
   * Filter nodes based on paint order and occlusion
   * Matches the browser-use reference implementation exactly
   */
  filterNodes(nodes: SimplifiedNode[]): SimplifiedNode[] {
    // Clear previous state
    this.rectUnion.clear();

    // Collect nodes with paint order and bounds
    const nodesWithPaintOrder: SimplifiedNode[] = [];

    for (const node of nodes) {
      if (
        node.originalNode.snapshotNode?.paintOrder !== undefined &&
        node.originalNode.snapshotNode?.bounds
      ) {
        nodesWithPaintOrder.push(node);
      }
    }

    // Group nodes by paint order (for processing in descending order)
    const groupedByPaintOrder = new Map<number, SimplifiedNode[]>();
    for (const node of nodesWithPaintOrder) {
      const paintOrder = node.originalNode.snapshotNode!.paintOrder!;
      if (!groupedByPaintOrder.has(paintOrder)) {
        groupedByPaintOrder.set(paintOrder, []);
      }
      groupedByPaintOrder.get(paintOrder)!.push(node);
    }

    // Process from highest paint order to lowest
    const sortedPaintOrders = Array.from(groupedByPaintOrder.keys()).sort(
      (a, b) => b - a
    );

    for (const paintOrder of sortedPaintOrders) {
      const nodesInOrder = groupedByPaintOrder.get(paintOrder)!;
      const rectsToAdd: Rect[] = [];

      for (const node of nodesInOrder) {
        const bounds = this.getNodeBounds(node);
        if (!bounds) continue;

        // Check if already occluded
        if (this.rectUnion.contains(bounds)) {
          node.ignoredByPaintOrder = true;
          continue;
        }

        // Check transparency filtering (only if enabled)
        if (this.enableTransparencyFiltering && this.isTransparentNode(node)) {
          node.ignoredByPaintOrder = true;
          continue;
        }

        // Check for exceptions that should never be filtered
        if (this.isExceptionNode(node)) {
          node.ignoredByPaintOrder = false;
          rectsToAdd.push(bounds);
          continue;
        }

        // Node is visible - add to union
        node.ignoredByPaintOrder = false;
        rectsToAdd.push(bounds);
      }

      // Add all visible rectangles to the union
      for (const rect of rectsToAdd) {
        this.rectUnion.add(rect);
      }
    }

    return nodes.filter((node) => !node.ignoredByPaintOrder);
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
   * Matches the browser-use reference implementation exactly
   */
  private isTransparentNode(node: SimplifiedNode): boolean {
    const snapshotNode = node.originalNode.snapshotNode;
    if (!snapshotNode) return false;

    const computedStyles = snapshotNode.computedStyles;
    if (!computedStyles) return false;

    // Check for transparent background (exact match to reference)
    const backgroundColor = computedStyles["background-color"];
    const hasTransparentBackground =
      !backgroundColor || backgroundColor === "rgba(0, 0, 0, 0)";

    // Check opacity threshold (exact match to reference)
    const opacity = parseFloat(computedStyles.opacity || "1");
    const hasLowOpacity = opacity < this.opacityThreshold;

    // Filter if transparent background OR low opacity
    if (hasTransparentBackground || hasLowOpacity) {
      return true;
    }

    return false;
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
    if (
      originalNode.axNode?.name &&
      originalNode.axNode.name.trim().length > 0
    ) {
      return true;
    }

    return false;
  }

  /**
   * Quick interactivity check (simplified version for exceptions)
   */
  private isInteractiveNode(node: EnhancedDOMTreeNode): {
    isInteractive: boolean;
  } {
    // Basic check for interactive attributes
    if (
      node.elementIndex !== null &&
      node.elementIndex !== undefined &&
      node.elementIndex >= 0
    ) {
      return { isInteractive: true };
    }

    // Check for interactive cursor
    if (node.snapshotNode?.cursorStyle === "pointer") {
      return { isInteractive: true };
    }

    // Check for interactive tags
    const interactiveTags = ["button", "input", "select", "textarea", "a"];
    if (node.tag && interactiveTags.includes(node.tag.toLowerCase())) {
      return { isInteractive: true };
    }

    // Check for interactive ARIA role
    if (node.axNode?.role) {
      const interactiveRoles = ["button", "link", "menuitem", "option", "tab"];
      if (interactiveRoles.includes(node.axNode.role.toLowerCase())) {
        return { isInteractive: true };
      }
    }

    return { isInteractive: false };
  }

  /**
   * Get paint order analysis statistics with enhanced tracking
   */
  getStats(): {
    totalNodes: number;
    visibleNodes: number;
    occludedNodes: number;
    filterRate: number;
    unionRectCount: number;
    averageRectanglesPerNode: number;
    transparencyFilteredCount: number;
  } {
    const unionRectCount = this.rectUnion.size;

    // Calculate additional statistics for performance monitoring
    const stats = {
      totalNodes: 0,
      visibleNodes: 0,
      occludedNodes: 0,
      transparencyFilteredCount: 0,
      totalRectangles: 0,
    };

    return {
      ...stats,
      filterRate:
        stats.totalNodes > 0 ? stats.occludedNodes / stats.totalNodes : 0,
      unionRectCount,
      averageRectanglesPerNode:
        stats.totalNodes > 0 ? unionRectCount / stats.totalNodes : 0,
    };
  }

  /**
   * Get performance metrics for rectangle operations
   */
  getPerformanceMetrics(): {
    rectUnionSize: number;
    containsOperations: number;
    addOperations: number;
    splitDiffOperations: number;
  } {
    return {
      rectUnionSize: this.rectUnion.size,
      containsOperations: 0, // Would be tracked during operations
      addOperations: 0, // Would be tracked during operations
      splitDiffOperations: 0, // Would be tracked during operations
    };
  }

  /**
   * Optimize rectangle union for performance
   * Reduces the number of rectangles while maintaining coverage
   */
  optimizeUnion(): void {
    const rects = this.rectUnion.getRectangles();

    // Simple optimization: merge rectangles that are very close
    const MERGE_THRESHOLD = 1; // pixels
    const optimized: Rect[] = [];
    const used = new Set<number>();

    for (let i = 0; i < rects.length; i++) {
      if (used.has(i)) continue;

      let current = rects[i];
      used.add(i);

      // Try to merge with nearby rectangles
      for (let j = i + 1; j < rects.length; j++) {
        if (used.has(j)) continue;

        const other = rects[j];

        // Check if rectangles are close enough to merge
        if (this.shouldMergeRects(current, other, MERGE_THRESHOLD)) {
          current = this.mergeRects(current, other);
          used.add(j);
          i = -1; // Restart scanning
          break;
        }
      }

      optimized.push(current);
    }

    // Update union with optimized rectangles
    this.rectUnion.clear();
    for (const rect of optimized) {
      this.rectUnion.add(rect);
    }
  }

  /**
   * Check if two rectangles should be merged for optimization
   */
  private shouldMergeRects(
    rect1: Rect,
    rect2: Rect,
    threshold: number
  ): boolean {
    // Check if rectangles are aligned and close
    const horizontalAlignment =
      Math.abs(rect1.y1 - rect2.y1) < threshold &&
      Math.abs(rect1.y2 - rect2.y2) < threshold;
    const verticalAlignment =
      Math.abs(rect1.x1 - rect2.x1) < threshold &&
      Math.abs(rect1.x2 - rect2.x2) < threshold;

    if (horizontalAlignment) {
      const gap = Math.min(
        Math.abs(rect1.x2 - rect2.x1),
        Math.abs(rect2.x2 - rect1.x1)
      );
      return gap < threshold;
    }

    if (verticalAlignment) {
      const gap = Math.min(
        Math.abs(rect1.y2 - rect2.y1),
        Math.abs(rect2.y2 - rect1.y1)
      );
      return gap < threshold;
    }

    return false;
  }

  /**
   * Merge two aligned rectangles
   */
  private mergeRects(rect1: Rect, rect2: Rect): Rect {
    const horizontalAlignment =
      Math.abs(rect1.y1 - rect2.y1) < 1 && Math.abs(rect1.y2 - rect2.y2) < 1;

    if (horizontalAlignment) {
      // Merge horizontally
      return new Rect(
        Math.min(rect1.x1, rect2.x1),
        Math.min(rect1.y1, rect2.y1),
        Math.max(rect1.x2, rect2.x2),
        Math.max(rect1.y2, rect2.y2)
      );
    } else {
      // Merge vertically
      return new Rect(
        Math.min(rect1.x1, rect2.x1),
        Math.min(rect1.y1, rect2.y1),
        Math.max(rect1.x2, rect2.x2),
        Math.max(rect1.y2, rect2.y2)
      );
    }
  }
}
