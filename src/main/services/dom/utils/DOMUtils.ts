/**
 * Simplified DOM Utilities - Essential functions following browser-use patterns
 */

import type { DOMSnapshot, EnhancedSnapshotNode, DOMRect } from "@shared/dom";

/**
 * Build snapshot lookup (simplified)
 */
export function buildSnapshotLookup(
  snapshot: DOMSnapshot,
  devicePixelRatio: number = 1.0
): Record<number, EnhancedSnapshotNode> {
  const lookup: Record<number, EnhancedSnapshotNode> = {};

  if (!snapshot.documents?.[0]) return lookup;

  const { nodeTree, layout } = snapshot.documents[0];
  if (!nodeTree?.backendNodeId || !layout?.nodeIndex) return lookup;

  // Simple lookup for backend node IDs
  for (let i = 0; i < nodeTree.backendNodeId.length; i++) {
    const nodeId = nodeTree.backendNodeId[i];
    const isClickable = nodeTree.isClickable?.index?.includes(i) || false;

    let bounds: DOMRect | null = null;
    const computedStyles: Record<string, string> | null = null;
    let cursorStyle: string | undefined;

    // Find layout data
    const layoutIdx = layout.nodeIndex.indexOf(i);
    if (layoutIdx >= 0 && layout.bounds && layout.bounds[layoutIdx]?.length >= 4) {
      // Parse bounds
      const boundsData = layout.bounds[layoutIdx];
      const [x, y, w, h] = boundsData;
      bounds = {
        x: x / devicePixelRatio,
        y: y / devicePixelRatio,
        width: w / devicePixelRatio,
        height: h / devicePixelRatio,
        x1: x / devicePixelRatio,
        y1: y / devicePixelRatio,
        x2: (x + w) / devicePixelRatio,
        y2: (y + h) / devicePixelRatio,
        area: (w * h) / (devicePixelRatio * devicePixelRatio),
        toDict() { return { x: this.x, y: this.y, width: this.width, height: this.height }; }
      };
    }

    lookup[nodeId] = {
      isClickable,
      cursorStyle,
      bounds,
      computedStyles,
      clientRects: null,
      scrollRects: null,
      paintOrder: undefined,
      stackingContexts: undefined,
    };
  }

  return lookup;
}

/**
 * Check if element is visible
 */
export function isElementVisible(computedStyles: Record<string, string> | null): boolean {
  if (!computedStyles) return true;

  const display = computedStyles.display?.toLowerCase();
  const visibility = computedStyles.visibility?.toLowerCase();
  const opacity = parseFloat(computedStyles.opacity || '1');

  return display !== 'none' && visibility !== 'hidden' && opacity > 0;
}

/**
 * Check if element is clickable
 */
export function isElementClickable(cursorStyle?: string): boolean {
  return cursorStyle === 'pointer';
}

/**
 * Extract scroll info (simplified)
 */
export function extractScrollInfo(
  scrollRects: DOMRect | null,
  clientRects: DOMRect | null
): { scrollTop: number; scrollLeft: number; scrollableHeight: number; scrollableWidth: number; visibleHeight: number; visibleWidth: number } | null {
  if (!scrollRects || !clientRects) return null;

  return {
    scrollTop: scrollRects.y,
    scrollLeft: scrollRects.x,
    scrollableHeight: scrollRects.height,
    scrollableWidth: scrollRects.width,
    visibleHeight: clientRects.height,
    visibleWidth: clientRects.width,
  };
}

/**
 * Check if element is scrollable
 */
export function isElementScrollable(
  scrollRects: DOMRect | null,
  clientRects: DOMRect | null,
  computedStyles: Record<string, string> | null
): boolean {
  if (!scrollRects || !clientRects) return false;

  const hasScroll = scrollRects.height > clientRects.height + 1 ||
                   scrollRects.width > clientRects.width + 1;

  if (!hasScroll) return false;

  if (computedStyles) {
    const overflow = computedStyles.overflow?.toLowerCase() || 'visible';
    return ['auto', 'scroll'].includes(overflow);
  }

  return true;
}

/**
 * Calculate absolute position
 */
export function calculateAbsolutePosition(
  node: { snapshotNode?: { bounds?: DOMRect | null } },
  frameOffset: DOMRect = { x: 0, y: 0, width: 0, height: 0, x1: 0, y1: 0, x2: 0, y2: 0, area: 0, toDict() { return {}; } }
): DOMRect | null {
  if (!node.snapshotNode?.bounds) return null;

  const bounds = node.snapshotNode.bounds;
  return {
    x: bounds.x + frameOffset.x,
    y: bounds.y + frameOffset.y,
    width: bounds.width,
    height: bounds.height,
    x1: bounds.x + frameOffset.x,
    y1: bounds.y + frameOffset.y,
    x2: bounds.x + frameOffset.x + bounds.width,
    y2: bounds.y + frameOffset.y + bounds.height,
    area: bounds.area,
    toDict() { return { x: this.x, y: this.y, width: this.width, height: this.height }; }
  };
}

/**
 * Calculate scroll percentage
 */
export function calculateScrollPercentage(
  _elementBounds: DOMRect,
  scrollInfo: { scrollTop: number; scrollLeft: number; scrollableHeight: number; scrollableWidth: number; visibleHeight: number; visibleWidth: number }
): { vertical: number; horizontal: number } {
  let vertical = 0;
  let horizontal = 0;

  if (scrollInfo.scrollableHeight > scrollInfo.visibleHeight) {
    const maxScroll = scrollInfo.scrollableHeight - scrollInfo.visibleHeight;
    vertical = maxScroll > 0 ? (scrollInfo.scrollTop / maxScroll) * 100 : 0;
  }

  if (scrollInfo.scrollableWidth > scrollInfo.visibleWidth) {
    const maxScroll = scrollInfo.scrollableWidth - scrollInfo.visibleWidth;
    horizontal = maxScroll > 0 ? (scrollInfo.scrollLeft / maxScroll) * 100 : 0;
  }

  return {
    vertical: Math.round(vertical * 10) / 10,
    horizontal: Math.round(horizontal * 10) / 10,
  };
}