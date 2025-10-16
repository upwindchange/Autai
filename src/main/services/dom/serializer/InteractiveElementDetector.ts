/**
 * Interactive Element Detector - Simple boolean-based detection
 *
 * Simplified implementation following browser-use patterns with straightforward
 * boolean checks and early returns for reliable interactive element identification.
 */

import type { EnhancedDOMTreeNode } from "@shared/dom";
import { NodeType } from "@shared/dom";

/**
 * Interactive element detector with simple boolean logic
 */
export class InteractiveElementDetector {
  // Interactive HTML tags
  private static readonly INTERACTIVE_TAGS = new Set([
    "button",
    "input",
    "select",
    "textarea",
    "a",
    "details",
    "summary",
    "option",
    "optgroup",
  ]);

  // Interactive ARIA roles
  private static readonly INTERACTIVE_ROLES = new Set([
    "button",
    "link",
    "menuitem",
    "menuitemcheckbox",
    "menuitemradio",
    "option",
    "tab",
    "treeitem",
    "gridcell",
    "combobox",
    "listbox",
    "textbox",
    "checkbox",
    "radio",
    "slider",
    "spinbutton",
    "search",
    "searchbox",
  ]);

  // Interactive event handlers
  private static readonly INTERACTIVE_EVENTS = new Set([
    "onclick",
    "onmousedown",
    "onmouseup",
    "onkeydown",
    "onkeyup",
    "onkeypress",
    "ontouchstart",
    "ontouchend",
    "onsubmit",
    "tabindex",
  ]);

  // Search element patterns
  private static readonly SEARCH_PATTERNS = [
    "search",
    "magnify",
    "glass",
    "lookup",
    "find",
    "query",
    "search-icon",
    "search-btn",
    "search-button",
    "searchbox",
  ];

  /**
   * Check if element is interactive using simple boolean detection
   * Returns true/false following browser-use patterns
   */
  static isInteractive(node: EnhancedDOMTreeNode): boolean {
    // Skip non-element nodes
    if (node.nodeType !== NodeType.ELEMENT_NODE) {
      return false;
    }

    // Remove html and body nodes
    if (node.tag && ["html", "body"].includes(node.tag)) {
      return false;
    }

    // IFRAME elements should be interactive if they're large enough
    if (node.tag && ["iframe", "frame"].includes(node.tag)) {
      if (node.snapshotNode?.bounds) {
        const width = node.snapshotNode.bounds.width;
        const height = node.snapshotNode.bounds.height;
        // Only include iframes larger than 100x100px
        if (width > 100 && height > 100) {
          return true;
        }
      }
    }

    // SEARCH ELEMENT DETECTION: Check for search-related classes and attributes
    if (node.attributes) {
      // Check class names for search indicators
      const classValue = node.attributes["class"] || "";
      const classList = classValue.toLowerCase().split(/\s+/);
      if (
        classList.some((cls) =>
          this.SEARCH_PATTERNS.some((pattern) => cls.includes(pattern))
        )
      ) {
        return true;
      }

      // Check id for search indicators
      const elementId = (node.attributes["id"] || "").toLowerCase();
      if (this.SEARCH_PATTERNS.some((pattern) => elementId.includes(pattern))) {
        return true;
      }

      // Check data attributes for search functionality
      for (const [attrName, attrValue] of Object.entries(node.attributes)) {
        if (
          attrName.startsWith("data-") &&
          this.SEARCH_PATTERNS.some((pattern) =>
            attrValue.toLowerCase().includes(pattern)
          )
        ) {
          return true;
        }
      }
    }

    // Enhanced accessibility property checks - direct clear indicators only
    if (node.axNode?.properties) {
      for (const prop of node.axNode.properties) {
        try {
          // aria disabled
          if (prop.name === "disabled" && prop.value) {
            return false;
          }

          // aria hidden
          if (prop.name === "hidden" && prop.value) {
            return false;
          }

          // Direct interactiveness indicators
          if (
            ["focusable", "editable", "settable"].includes(prop.name) &&
            prop.value
          ) {
            return true;
          }

          // Interactive state properties (presence indicates interactive widget)
          if (
            ["checked", "expanded", "pressed", "selected"].includes(prop.name)
          ) {
            return true;
          }

          // Form-related interactiveness
          if (["required", "autocomplete"].includes(prop.name) && prop.value) {
            return true;
          }

          // Elements with keyboard shortcuts are interactive
          if (prop.name === "keyshortcuts" && prop.value) {
            return true;
          }
        } catch (_) {
          // Skip properties we can't process
          continue;
        }
      }
    }

    // Interactive tag check
    if (node.tag && this.INTERACTIVE_TAGS.has(node.tag)) {
      return true;
    }

    // Check for interactive attributes
    if (node.attributes) {
      // Check for event handlers or interactive attributes
      const hasEventHandler = Array.from(this.INTERACTIVE_EVENTS).some(
        (attr) => attr in node.attributes
      );
      if (hasEventHandler) {
        return true;
      }

      // Check for interactive ARIA roles
      const role = node.attributes["role"];
      if (role && this.INTERACTIVE_ROLES.has(role)) {
        return true;
      }
    }

    // Accessibility tree roles
    if (node.axNode?.role && this.INTERACTIVE_ROLES.has(node.axNode.role)) {
      return true;
    }

    // Icon detection for small elements
    if (node.snapshotNode?.bounds) {
      const { width, height } = node.snapshotNode.bounds;
      if (width >= 10 && width <= 50 && height >= 10 && height <= 50) {
        // Check if this small element has interactive properties
        if (node.attributes) {
          const iconAttributes = [
            "class",
            "role",
            "onclick",
            "data-action",
            "aria-label",
          ];
          if (iconAttributes.some((attr) => attr in node.attributes)) {
            return true;
          }
        }
      }
    }

    // Final fallback: cursor style indicates interactivity
    if (node.snapshotNode?.cursorStyle === "pointer") {
      return true;
    }

    return false;
  }

  /**
   * Get detailed debug information for element detection
   */
  static getDebugInfo(node: EnhancedDOMTreeNode): {
    tagName: string;
    attributes: Record<string, string>;
    accessibility: {
      role?: string;
      name?: string;
      properties?: Array<{ name: string; value: unknown }>;
    };
    visual: {
      cursor?: string;
      isVisible?: boolean;
      bounds?: { width: number; height: number };
    };
    detection: { isInteractive: boolean };
  } {
    return {
      tagName: node.tag || "unknown",
      attributes: node.attributes,
      accessibility: {
        role: node.axNode?.role || undefined,
        name: node.axNode?.name || undefined,
        properties: node.axNode?.properties || [],
      },
      visual: {
        cursor: node.snapshotNode?.cursorStyle,
        isVisible: node.isVisible || false,
        bounds: node.snapshotNode?.bounds
          ? {
              width: node.snapshotNode.bounds.width,
              height: node.snapshotNode.bounds.height,
            }
          : undefined,
      },
      detection: { isInteractive: this.isInteractive(node) },
    };
  }
}
