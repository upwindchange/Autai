/**
 * Snapshot Processor - Processes DOMSnapshot data from CDP
 *
 * Handles extraction and processing of computed styles, bounding boxes,
 * scroll positions, and other layout information from DOMSnapshot.
 */

import type { DOMSnapshot, EnhancedSnapshotNode, DOMRect } from "@shared/dom";

/**
 * Required computed styles for DOM analysis (minimal set to prevent Chrome crashes)
 */
const REQUIRED_COMPUTED_STYLES = [
  'display',        // Used in visibility detection
  'visibility',     // Used in visibility detection
  'opacity',        // Used in visibility detection
  'overflow',       // Used in scrollability detection
  'overflow-x',     // Used in scrollability detection
  'overflow-y',     // Used in scrollability detection
  'cursor',         // Used for clickability detection
  'pointer-events', // Used for clickability logic
  'position',       // Used for visibility logic
  'background-color', // Used for visibility logic
];

/**
 * Processes DOMSnapshot data to extract enhanced information
 */
export class SnapshotProcessor {
  /**
   * Build a lookup table of backend node ID to enhanced snapshot data
   *
   * @param snapshot - DOM snapshot data from CDP
   * @param devicePixelRatio - Device pixel ratio for coordinate conversion
   * @returns Lookup table mapping backend node IDs to enhanced snapshot nodes
   */
  static buildSnapshotLookup(
    snapshot: DOMSnapshot,
    devicePixelRatio: number = 1.0
  ): Record<number, EnhancedSnapshotNode> {
    const snapshotLookup: Record<number, EnhancedSnapshotNode> = {};

    if (!snapshot.documents || snapshot.documents.length === 0) {
      return snapshotLookup;
    }

    const strings = snapshot.strings;

    // Process each document in the snapshot
    for (const document of snapshot.documents) {
      const nodes = document.nodeTree;
      const layout = document.layout;

      // Build backend node ID to snapshot index lookup
      const backendNodeToSnapshotIndex: Record<number, number> = {};
      if (nodes.backendNodeId) {
        for (let i = 0; i < nodes.backendNodeId.length; i++) {
          backendNodeToSnapshotIndex[nodes.backendNodeId[i]] = i;
        }
      }

      // Build layout index map for efficient lookup (use first occurrence for duplicates)
      const layoutIndexMap: Record<number, number> = {};
      if (layout?.nodeIndex) {
        for (let layoutIdx = 0; layoutIdx < layout.nodeIndex.length; layoutIdx++) {
          const nodeIndex = layout.nodeIndex[layoutIdx];
          if (nodeIndex !== undefined && !(nodeIndex in layoutIndexMap)) {
            layoutIndexMap[nodeIndex] = layoutIdx;
          }
        }
      }

      // Build snapshot lookup for each backend node ID
      for (const [backendNodeId, snapshotIndex] of Object.entries(backendNodeToSnapshotIndex)) {
        const nodeId = parseInt(backendNodeId);
        const index = snapshotIndex;

        // Parse rare boolean data for clickability
        let isClickable = false;
        if (nodes.isClickable?.index) {
          isClickable = nodes.isClickable.index.includes(index);
        }

        // Find corresponding layout node and extract data
        let cursorStyle: string | undefined;
        let boundingBox: DOMRect | null = null;
        let computedStyles: Record<string, string> | null = null;
        let paintOrder: number | undefined;
        let clientRects: DOMRect | null = null;
        let scrollRects: DOMRect | null = null;
        let stackingContexts: number | undefined;

        if (layoutIndexMap[index] !== undefined) {
          const layoutIdx = layoutIndexMap[index];

          // Parse bounding box
          if (layout.bounds?.[layoutIdx]) {
            const bounds = layout.bounds[layoutIdx];
            if (bounds && bounds.length >= 4) {
              // Convert device pixels to CSS pixels
              const [rawX, rawY, rawWidth, rawHeight] = bounds;
              boundingBox = {
                x: rawX / devicePixelRatio,
                y: rawY / devicePixelRatio,
                width: rawWidth / devicePixelRatio,
                height: rawHeight / devicePixelRatio,
                toDict() {
                  return { x: this.x, y: this.y, width: this.width, height: this.height };
                }
              };
            }
          }

          // Parse computed styles
          if (layout.styles?.[layoutIdx]) {
            const styleIndices = layout.styles[layoutIdx];
            computedStyles = SnapshotProcessor.parseComputedStyles(strings, styleIndices);
            cursorStyle = computedStyles.cursor;
          }

          // Extract paint order
          if (layout.paintOrders?.[layoutIdx] !== undefined) {
            paintOrder = layout.paintOrders[layoutIdx];
          }

          // Extract client rects
          if (layout.clientRects?.[layoutIdx]) {
            const clientRectData = layout.clientRects[layoutIdx];
            if (clientRectData && clientRectData.length >= 4) {
              const [x, y, width, height] = clientRectData;
              clientRects = {
                x, y, width, height,
                toDict() {
                  return { x: this.x, y: this.y, width: this.width, height: this.height };
                }
              };
            }
          }

          // Extract scroll rects
          if (layout.scrollRects?.[layoutIdx]) {
            const scrollRectData = layout.scrollRects[layoutIdx];
            if (scrollRectData && scrollRectData.length >= 4) {
              const [x, y, width, height] = scrollRectData;
              scrollRects = {
                x, y, width, height,
                toDict() {
                  return { x: this.x, y: this.y, width: this.width, height: this.height };
                }
              };
            }
          }

          // Extract stacking contexts
          if (layout.stackingContexts?.index?.[layoutIdx] !== undefined) {
            stackingContexts = layout.stackingContexts.index[layoutIdx];
          }
        }

        // Create enhanced snapshot node
        snapshotLookup[nodeId] = {
          isClickable,
          cursorStyle,
          bounds: boundingBox,
          clientRects,
          scrollRects,
          computedStyles,
          paintOrder,
          stackingContexts,
        };
      }
    }

    return snapshotLookup;
  }

  /**
   * Parse computed styles from layout tree using string indices
   *
   * @param strings - String table from snapshot
   * @param styleIndices - Array of string indices for computed styles
   * @returns Parsed computed styles as key-value pairs
   */
  private static parseComputedStyles(
    strings: string[],
    styleIndices: number[]
  ): Record<string, string> {
    const styles: Record<string, string> = {};

    for (let i = 0; i < styleIndices.length && i < REQUIRED_COMPUTED_STYLES.length; i++) {
      const styleIndex = styleIndices[i];
      if (styleIndex >= 0 && styleIndex < strings.length) {
        styles[REQUIRED_COMPUTED_STYLES[i]] = strings[styleIndex];
      }
    }

    return styles;
  }

  /**
   * Check if an element is visible based on computed styles
   *
   * @param computedStyles - Computed styles from snapshot
   * @returns True if element appears to be visible
   */
  static isElementVisible(computedStyles: Record<string, string> | null): boolean {
    if (!computedStyles) {
      return true; // Assume visible if no style info
    }

    const display = computedStyles.display?.toLowerCase();
    const visibility = computedStyles.visibility?.toLowerCase();
    const opacity = parseFloat(computedStyles.opacity || '1');

    // Check for hidden styles
    if (display === 'none' || visibility === 'hidden' || opacity <= 0) {
      return false;
    }

    return true;
  }

  /**
   * Check if an element appears clickable based on cursor style
   *
   * @param cursorStyle - Cursor style from computed styles
   * @returns True if element appears clickable
   */
  static isElementClickable(cursorStyle?: string): boolean {
    return cursorStyle === 'pointer';
  }

  /**
   * Extract scroll information from snapshot data
   *
   * @param scrollRects - Scroll rectangles from snapshot
   * @param clientRects - Client rectangles from snapshot
   * @returns Scroll information object
   */
  static extractScrollInfo(
    scrollRects: DOMRect | null,
    clientRects: DOMRect | null
  ): {
    scrollTop: number;
    scrollLeft: number;
    scrollableHeight: number;
    scrollableWidth: number;
    visibleHeight: number;
    visibleWidth: number;
  } | null {
    if (!scrollRects || !clientRects) {
      return null;
    }

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
   * Check if an element is scrollable based on dimensions
   *
   * @param scrollRects - Scroll rectangles from snapshot
   * @param clientRects - Client rectangles from snapshot
   * @param computedStyles - Computed styles from snapshot
   * @returns True if element appears scrollable
   */
  static isElementScrollable(
    scrollRects: DOMRect | null,
    clientRects: DOMRect | null,
    computedStyles: Record<string, string> | null
  ): boolean {
    if (!scrollRects || !clientRects) {
      return false;
    }

    // Check if content is larger than visible area
    const hasVerticalScroll = scrollRects.height > clientRects.height + 1;
    const hasHorizontalScroll = scrollRects.width > clientRects.width + 1;

    if (!hasVerticalScroll && !hasHorizontalScroll) {
      return false;
    }

    // Check CSS to ensure scrolling is allowed
    if (computedStyles) {
      const overflow = computedStyles.overflow?.toLowerCase() || 'visible';
      const overflowX = computedStyles['overflow-x']?.toLowerCase() || overflow;
      const overflowY = computedStyles['overflow-y']?.toLowerCase() || overflow;

      // Only allow scrolling if overflow is explicitly set to auto, scroll, or overlay
      const allowsScroll = ['auto', 'scroll', 'overlay'].includes(overflowX) ||
                           ['auto', 'scroll', 'overlay'].includes(overflowY);

      return allowsScroll;
    }

    // Default to true for common scrollable containers if no CSS info
    return true;
  }
}