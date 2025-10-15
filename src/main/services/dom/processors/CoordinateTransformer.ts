/**
 * Coordinate Transformer - Handles coordinate transformations across frames and viewports
 *
 * Manages device pixel ratio conversions, iframe coordinate transformations,
 * and scroll position corrections for accurate element positioning.
 */

import type { DOMRect, EnhancedDOMTreeNode, ViewportInfo } from "@shared/dom";

/**
 * Handles coordinate transformations for DOM elements
 */
export class CoordinateTransformer {
  /**
   * Convert device pixel coordinates to CSS pixel coordinates
   *
   * @param rect - Rectangle in device pixels
   * @param devicePixelRatio - Device pixel ratio
   * @returns Rectangle in CSS pixels
   */
  static deviceToCSSPixels(rect: DOMRect, devicePixelRatio: number): DOMRect {
    return {
      x: rect.x / devicePixelRatio,
      y: rect.y / devicePixelRatio,
      width: rect.width / devicePixelRatio,
      height: rect.height / devicePixelRatio,
      toDict() {
        return { x: this.x, y: this.y, width: this.width, height: this.height };
      }
    };
  }

  /**
   * Convert CSS pixel coordinates to device pixel coordinates
   *
   * @param rect - Rectangle in CSS pixels
   * @param devicePixelRatio - Device pixel ratio
   * @returns Rectangle in device pixels
   */
  static csToDevicePixels(rect: DOMRect, devicePixelRatio: number): DOMRect {
    return {
      x: rect.x * devicePixelRatio,
      y: rect.y * devicePixelRatio,
      width: rect.width * devicePixelRatio,
      height: rect.height * devicePixelRatio,
      toDict() {
        return { x: this.x, y: this.y, width: this.width, height: this.height };
      }
    };
  }

  /**
   * Calculate absolute position of an element accounting for iframe offsets
   *
   * @param node - DOM node to calculate position for
   * @param totalFrameOffset - Accumulated frame offset from parent iframes
   * @returns Absolute position in the top-level document
   */
  static calculateAbsolutePosition(
    node: EnhancedDOMTreeNode,
    totalFrameOffset: DOMRect = { x: 0, y: 0, width: 0, height: 0, toDict() { return { x: this.x, y: this.y, width: this.width, height: this.height }; } }
  ): DOMRect | null {
    if (!node.snapshotNode?.bounds) {
      return null;
    }

    // Add frame offset to element's local bounds
    const absolutePosition = {
      x: node.snapshotNode.bounds.x + totalFrameOffset.x,
      y: node.snapshotNode.bounds.y + totalFrameOffset.y,
      width: node.snapshotNode.bounds.width,
      height: node.snapshotNode.bounds.height,
      toDict() {
        return { x: this.x, y: this.y, width: this.width, height: this.height };
      }
    };

    return absolutePosition;
  }

  /**
   * Update frame offset when entering an iframe
   *
   * @param currentOffset - Current accumulated frame offset
   * @param iframeBounds - Bounds of the iframe element
   * @returns New frame offset including iframe position
   */
  static updateFrameOffsetForIframe(
    currentOffset: DOMRect,
    iframeBounds: DOMRect
  ): DOMRect {
    return {
      x: currentOffset.x + iframeBounds.x,
      y: currentOffset.y + iframeBounds.y,
      width: currentOffset.width,
      height: currentOffset.height,
      toDict() {
        return { x: this.x, y: this.y, width: this.width, height: this.height };
      }
    };
  }

  /**
   * Update frame offset when processing HTML frame content (account for scroll)
   *
   * @param currentOffset - Current accumulated frame offset
   * @param scrollPosition - Scroll position of the frame
   * @returns New frame offset accounting for scroll
   */
  static updateFrameOffsetForScroll(
    currentOffset: DOMRect,
    scrollPosition: { x: number; y: number }
  ): DOMRect {
    return {
      x: currentOffset.x - scrollPosition.x,
      y: currentOffset.y - scrollPosition.y,
      width: currentOffset.width,
      height: currentOffset.height,
      toDict() {
        return { x: this.x, y: this.y, width: this.width, height: this.height };
      }
    };
  }

  /**
   * Check if a point is within a rectangle
   *
   * @param point - Point to check
   * @param rect - Rectangle to check against
   * @returns True if point is within rectangle
   */
  static isPointInRect(point: { x: number; y: number }, rect: DOMRect): boolean {
    return (
      point.x >= rect.x &&
      point.x <= rect.x + rect.width &&
      point.y >= rect.y &&
      point.y <= rect.y + rect.height
    );
  }

  /**
   * Calculate intersection of two rectangles
   *
   * @param rect1 - First rectangle
   * @param rect2 - Second rectangle
   * @returns Intersection rectangle, or null if no intersection
   */
  static calculateIntersection(rect1: DOMRect, rect2: DOMRect): DOMRect | null {
    const x = Math.max(rect1.x, rect2.x);
    const y = Math.max(rect1.y, rect2.y);
    const width = Math.min(rect1.x + rect1.width, rect2.x + rect2.width) - x;
    const height = Math.min(rect1.y + rect1.height, rect2.y + rect2.height) - y;

    if (width <= 0 || height <= 0) {
      return null;
    }

    return {
      x, y, width, height,
      toDict() {
        return { x: this.x, y: this.y, width: this.width, height: this.height };
      }
    };
  }

  /**
   * Check if element is visible in viewport considering scroll position
   *
   * @param elementBounds - Element bounds
   * @param viewportInfo - Viewport information including scroll position
   * @returns True if element is visible in viewport
   */
  static isElementVisibleInViewport(
    elementBounds: DOMRect,
    viewportInfo: ViewportInfo
  ): boolean {
    // Create viewport rectangle
    const viewportRect = {
      x: viewportInfo.scrollX,
      y: viewportInfo.scrollY,
      width: viewportInfo.width,
      height: viewportInfo.height,
      toDict() {
        return { x: this.x, y: this.y, width: this.width, height: this.height };
      }
    };

    // Check if element intersects with viewport
    const intersection = CoordinateTransformer.calculateIntersection(elementBounds, viewportRect);
    return intersection !== null;
  }

  /**
   * Transform coordinates from iframe context to top-level context
   *
   * @param iframeCoordinates - Coordinates within iframe
   * @param iframePosition - Position of iframe in parent document
   * @param parentScrollOffset - Parent document scroll offset
   * @returns Coordinates in top-level document
   */
  static transformFromIframeToTopLevel(
    iframeCoordinates: DOMRect,
    iframePosition: DOMRect,
    parentScrollOffset: { x: number; y: number } = { x: 0, y: 0 }
  ): DOMRect {
    return {
      x: iframeCoordinates.x + iframePosition.x - parentScrollOffset.x,
      y: iframeCoordinates.y + iframePosition.y - parentScrollOffset.y,
      width: iframeCoordinates.width,
      height: iframeCoordinates.height,
      toDict() {
        return { x: this.x, y: this.y, width: this.width, height: this.height };
      }
    };
  }

  /**
   * Transform coordinates from top-level context to iframe context
   *
   * @param topLevelCoordinates - Coordinates in top-level document
   * @param iframePosition - Position of iframe in parent document
   * @param parentScrollOffset - Parent document scroll offset
   * @returns Coordinates within iframe
   */
  static transformFromTopLevelToIframe(
    topLevelCoordinates: DOMRect,
    iframePosition: DOMRect,
    parentScrollOffset: { x: number; y: number } = { x: 0, y: 0 }
  ): DOMRect {
    return {
      x: topLevelCoordinates.x - iframePosition.x + parentScrollOffset.x,
      y: topLevelCoordinates.y - iframePosition.y + parentScrollOffset.y,
      width: topLevelCoordinates.width,
      height: topLevelCoordinates.height,
      toDict() {
        return { x: this.x, y: this.y, width: this.width, height: this.height };
      }
    };
  }

  /**
   * Calculate scroll percentage for an element
   *
   * @param elementBounds - Element bounds
   * @param scrollInfo - Scroll information
   * @returns Scroll percentage (0-100)
   */
  static calculateScrollPercentage(
    _elementBounds: DOMRect,
    scrollInfo: {
      scrollTop: number;
      scrollLeft: number;
      scrollableHeight: number;
      scrollableWidth: number;
      visibleHeight: number;
      visibleWidth: number;
    }
  ): { vertical: number; horizontal: number } {
    let verticalPercentage = 0;
    let horizontalPercentage = 0;

    // Calculate vertical scroll percentage
    if (scrollInfo.scrollableHeight > scrollInfo.visibleHeight) {
      const maxScrollTop = scrollInfo.scrollableHeight - scrollInfo.visibleHeight;
      verticalPercentage = maxScrollTop > 0 ? (scrollInfo.scrollTop / maxScrollTop) * 100 : 0;
    }

    // Calculate horizontal scroll percentage
    if (scrollInfo.scrollableWidth > scrollInfo.visibleWidth) {
      const maxScrollLeft = scrollInfo.scrollableWidth - scrollInfo.visibleWidth;
      horizontalPercentage = maxScrollLeft > 0 ? (scrollInfo.scrollLeft / maxScrollLeft) * 100 : 0;
    }

    return {
      vertical: Math.round(verticalPercentage * 10) / 10, // Round to 1 decimal place
      horizontal: Math.round(horizontalPercentage * 10) / 10,
    };
  }

  /**
   * Clamp coordinates to be within bounds
   *
   * @param coordinates - Coordinates to clamp
   * @param bounds - Bounds to clamp to
   * @returns Clamped coordinates
   */
  static clampToBounds(coordinates: { x: number; y: number }, bounds: DOMRect): { x: number; y: number } {
    return {
      x: Math.max(bounds.x, Math.min(coordinates.x, bounds.x + bounds.width)),
      y: Math.max(bounds.y, Math.min(coordinates.y, bounds.y + bounds.height)),
    };
  }
}