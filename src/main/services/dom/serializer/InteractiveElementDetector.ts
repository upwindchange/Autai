/**
 * Interactive Element Detector - Dedicated class for detecting and highlighting interactive DOM elements
 *
 * Extracted from DOMTreeSerializer to provide better separation of concerns and testability.
 * Ports existing detection logic with placeholders for missing browser-use features.
 * Includes highlighting functionality using CDP commands.
 */

import type { EnhancedDOMTreeNode } from "@shared/dom";
import { NodeType } from "@shared/dom";
import type { WebContents } from "electron";
import log from "electron-log/main";
import {
  sendCDPCommand,
  isElementVisible,
  getElementSize,
} from "@/services/dom/utils/DOMUtils";

// Enhanced interactive element tags (ported from DOMTreeSerializer)
// Note: 'label' removed - labels with "for" attribute can destroy the real clickable element on apartments.com
const INTERACTIVE_TAGS = [
  "button",
  "input",
  "select",
  "textarea",
  "a",
  "option",
  "iframe",
  "frame",
  "details",
  "summary",
  "optgroup",
];

// Enhanced event handlers for interactive detection (ported from DOMTreeSerializer)
const EVENT_HANDLERS = [
  "onclick",
  "onmousedown",
  "onmouseup",
  "onkeydown",
  "onkeyup",
  "onkeypress",
  "onfocus",
  "onblur",
  "onchange",
  "onsubmit",
  "onreset",
  "onselect",
  "tabindex",
];

// Accessibility property categories for comprehensive analysis (ported from DOMTreeSerializer)
const DIRECT_INTERACTIVITY = ["focusable", "editable", "settable"];
const INTERACTIVE_STATES = ["checked", "expanded", "pressed", "selected"];
const FORM_PROPERTIES = ["required", "autocomplete", "keyshortcuts"];
const BLOCKER_PROPERTIES = ["disabled", "hidden"];

// Enhanced search element indicators for comprehensive search detection
const SEARCH_INDICATORS = [
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
  "filter",
  "filter-icon",
  "filter-btn",
  "find-button",
  "lookup-box",
  "query-input",
  "typeahead",
  "autocomplete",
  "suggest",
  "suggestion",
  "lookup-field",
  "search-field",
  "search-input",
  "search-form",
  "search-bar",
  "search-area",
];

// Size thresholds for element detection
const SIZE_THRESHOLDS = {
  MIN_ICON_SIZE: 10, // Minimum size for icon detection (px)
  MAX_ICON_SIZE: 50, // Maximum size for icon detection (px)
  MIN_IFRAME_WIDTH: 100, // Minimum iframe width for interactivity (px)
  MIN_IFRAME_HEIGHT: 100, // Minimum iframe height for interactivity (px)
  OPACITY_THRESHOLD: 0.8, // Minimum opacity for interactive elements
} as const;

// Compound Control Detection Constants (ported from browser-use)

// Input types that should be virtualized as compound controls
// NOTE: Date/time inputs are EXCLUDED because they confuse the model and HTML5 requires ISO format
const COMPOUND_INPUT_TYPES = ["range", "number", "color", "file"];

// Elements that should be virtualized as compound controls
const COMPOUND_ELEMENT_TAGS = ["select", "details", "audio", "video"];

// ARIA roles that should be virtualized as compound controls
const COMPOUND_ARIA_ROLES = ["combobox", "slider", "spinbutton", "listbox"];

// Note: PROPAGATING_ELEMENTS and DEFAULT_CONTAINMENT_THRESHOLD moved to BoundingBoxTypes.ts

// Icon detection attributes
const ICON_ATTRIBUTES = [
  "class",
  "role",
  "onclick",
  "data-action",
  "aria-label",
  "title",
  "data-icon",
  "data-testid",
  "data-cy",
  "data-qa",
  "id",
];

// Icon class patterns
const ICON_CLASS_PATTERNS = [
  "icon",
  "btn",
  "button",
  "click",
  "action",
  "trigger",
  "svg",
  "img",
  "glyph",
  "symbol",
  "logo",
  "brand",
];

/**
 * Interactive Element Detector Class
 *
 * Provides comprehensive detection of interactive DOM elements using a tiered approach.
 * Matches browser-use detection patterns with existing Autai-Core functionality.
 */
export class InteractiveElementDetector {
  private webContents: WebContents;
  private logger = log.scope("InteractiveElementDetector");

  constructor(webContents: WebContents) {
    this.webContents = webContents;
    this.logger.info("InteractiveElementDetector initialized");
  }

  /**
   * Check if element passes basic visual filtering (opacity, visibility)
   */
  private passesVisualFilter(node: EnhancedDOMTreeNode): boolean {
    // Use the existing utility function for visibility checking
    if (!isElementVisible(node.snapshotNode?.computedStyles || null)) {
      this.logger.debug(
        `Element ${node.nodeId} filtered out by visibility check`
      );
      return false;
    }

    // Additional opacity threshold check
    if (node.snapshotNode?.computedStyles?.opacity) {
      const opacity = parseFloat(node.snapshotNode.computedStyles.opacity);
      if (opacity < SIZE_THRESHOLDS.OPACITY_THRESHOLD) {
        this.logger.debug(
          `Element ${node.nodeId} filtered out by opacity threshold: ${opacity}`
        );
        return false;
      }
    }

    return true;
  }

  /**
   * Main detection method with on-the-fly highlighting
   *
   * @param node The DOM node to check for interactivity
   * @returns boolean indicating if the element is interactive
   */
  async isInteractive(node: EnhancedDOMTreeNode): Promise<boolean> {
    try {
      // Basic validation
      if (!node) {
        this.logger.warn("Node is null or undefined");
        return false;
      }

      // Tier 1: Quick filters
      if (!this.passesVisualFilter(node)) return false;
      if (!this.checkNodeType(node)) return false;
      if (this.checkSkippedElements(node)) return false;
      if (await this.checkIframeSize(node)) {
        return true; // Special case for iframes
      }

      // Tier 7: Compound control detection
      if (await this.checkCompoundControls(node)) {
        return true;
      }

      // Tier 2: Specialized tag detection
      if (this.checkSpecializedTags(node)) {
        return true;
      }

      // Tier 3: Search-related element detection
      if (this.checkSearchElements(node)) {
        return true;
      }

      // Tier 4: Attribute-based detection
      if (this.checkEventHandlers(node)) {
        return true;
      }
      if (this.checkARIAAttributes(node)) {
        return true;
      }
      if (this.checkInputAttributes(node)) {
        return true;
      }

      // Tier 5: Accessibility tree analysis
      if (this.checkAccessibilityProperties(node)) {
        return true;
      }
      if (this.checkAccessibilityRoles(node)) {
        return true;
      }

      // Tier 6: Visual/structural indicators
      if (await this.checkIconElements(node)) {
        return true;
      }
      if (this.checkCursorStyle(node)) {
        return true;
      }

      return false;
    } catch (error) {
      this.logger.error(
        `Error in isInteractive for node ${node.nodeId}:`,
        error
      );
      return false;
    }
  }

  // Tier 1: Quick Filters

  /**
   * Check if node is an element node
   * Only ELEMENT_NODE (nodeType: 1) can be interactive
   */
  private checkNodeType(node: EnhancedDOMTreeNode): boolean {
    return node.nodeType === NodeType.ELEMENT_NODE;
  }

  /**
   * Check if element should be skipped
   * HTML and BODY elements are not interactive by themselves
   */
  private checkSkippedElements(node: EnhancedDOMTreeNode): boolean {
    if (!node.tag) return false;
    const tag = node.tag.toLowerCase();
    return tag === "html" || tag === "body";
  }

  /**
   * Check iframe size requirements
   * Only iframes larger than 100x100px are considered interactive
   */
  private async checkIframeSize(node: EnhancedDOMTreeNode): Promise<boolean> {
    if (node.tag?.toLowerCase() !== "iframe") {
      return false;
    }

    const size = await getElementSize(node, this.webContents, this.logger);
    if (!size) {
      this.logger.warn(`Could not get size for iframe ${node.nodeId}`);
      return false;
    }

    const isLargeEnough =
      size.width >= SIZE_THRESHOLDS.MIN_IFRAME_WIDTH &&
      size.height >= SIZE_THRESHOLDS.MIN_IFRAME_HEIGHT;

    if (isLargeEnough) {
      this.logger.debug(
        `Iframe ${node.nodeId} passed size check: ${size.width}x${size.height}px`
      );
    }

    return isLargeEnough;
  }

  // Tier 3: Search Element Detection

  /**
   * Check for search-related elements
   * Detects search indicators in class names, IDs, and data attributes
   */
  private checkSearchElements(node: EnhancedDOMTreeNode): boolean {
    if (!node.attributes) return false;

    // Check class name for search indicators
    if (node.attributes.class) {
      const className = node.attributes.class.toLowerCase();
      for (const indicator of SEARCH_INDICATORS) {
        if (className.includes(indicator)) {
          return true;
        }
      }
    }

    // Check ID for search indicators
    if (node.attributes.id) {
      const id = node.attributes.id.toLowerCase();
      for (const indicator of SEARCH_INDICATORS) {
        if (id.includes(indicator)) {
          return true;
        }
      }
    }

    // Check data attributes for search indicators
    for (const [attrName, attrValue] of Object.entries(node.attributes)) {
      if (attrName.startsWith("data-") && attrValue) {
        const value = attrValue.toLowerCase();
        for (const indicator of SEARCH_INDICATORS) {
          if (value.includes(indicator)) {
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * Check for specialized interactive tags (ported from existing logic)
   */
  private checkSpecializedTags(node: EnhancedDOMTreeNode): boolean {
    if (!node.tag) return false;
    const tag = node.tag.toLowerCase();
    return INTERACTIVE_TAGS.includes(tag);
  }

  // Tier 4: Attribute-based Detection

  /**
   * Check for event handlers with enhanced detection
   */
  private checkEventHandlers(node: EnhancedDOMTreeNode): boolean {
    if (!node.attributes) return false;

    for (const handler of EVENT_HANDLERS) {
      if (handler === "tabindex") {
        // Special handling for tabindex - any tabindex (even 0) makes element focusable
        if (
          node.attributes[handler] !== undefined &&
          node.attributes[handler] !== null
        ) {
          return true;
        }
      } else if (
        handler === "onclick" ||
        handler === "onmousedown" ||
        handler === "onmouseup"
      ) {
        // Most reliable interactive indicators - check if they exist and are not empty
        const value = node.attributes[handler];
        if (
          value &&
          value !== "" &&
          value !== "null" &&
          value !== "undefined"
        ) {
          return true;
        }
      } else {
        // For other event handlers, check if they exist
        if (node.attributes[handler]) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Check for ARIA roles (ported from existing logic)
   */
  private checkARIAAttributes(node: EnhancedDOMTreeNode): boolean {
    if (!node.attributes?.role) return false;
    const role = node.attributes.role.toLowerCase();

    const interactiveRoles = [
      "button",
      "link",
      "menuitem",
      "option",
      "radio",
      "checkbox",
      "tab",
      "textbox",
      "combobox",
      "slider",
      "spinbutton",
      "search",
      "searchbox",
    ];

    return interactiveRoles.includes(role);
  }

  /**
   * Check for input-like attributes (ported from existing logic)
   */
  private checkInputAttributes(node: EnhancedDOMTreeNode): boolean {
    return node.attributes?.contenteditable === "true";
  }

  // Tier 5: Accessibility Tree Analysis

  /**
   * Extract actual value from CDP property object
   * Handles both direct values and CDP object format: {type: "boolean", value: true}
   */
  private extractPropValue(prop: unknown): unknown {
    // Handle CDP object format
    if (typeof prop === "object" && prop !== null && "value" in prop) {
      return prop.value;
    }
    // Handle direct values
    return prop;
  }

  /**
   * Check comprehensive accessibility properties (ported from existing logic)
   */
  private checkAccessibilityProperties(node: EnhancedDOMTreeNode): boolean {
    if (!node.axNode?.properties) return false;

    for (const prop of node.axNode.properties) {
      const propName = prop.name.toLowerCase();
      const propValue = this.extractPropValue(prop.value);

      // Check for blocker properties first (return false if true)
      if (
        BLOCKER_PROPERTIES.includes(propName) &&
        typeof propValue === "boolean" &&
        propValue === true
      ) {
        return false;
      }

      // Check for direct interactivity properties (return true if true)
      if (
        DIRECT_INTERACTIVITY.includes(propName) &&
        typeof propValue === "boolean" &&
        propValue === true
      ) {
        return true;
      }

      // Check for interactive state properties (return true if true)
      if (
        INTERACTIVE_STATES.includes(propName) &&
        typeof propValue === "boolean" &&
        propValue === true
      ) {
        return true;
      }

      // Check for form properties (return true if present)
      if (FORM_PROPERTIES.includes(propName) && propValue !== undefined) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check accessibility tree roles
   * Detects interactive elements based on their accessibility roles
   */
  private checkAccessibilityRoles(node: EnhancedDOMTreeNode): boolean {
    if (!node.axNode?.role?.value) return false;

    const role = node.axNode.role.value.toString().toLowerCase();

    // Comprehensive list of interactive accessibility roles
    const interactiveRoles = [
      "button",
      "link",
      "menuitem",
      "option",
      "radio",
      "checkbox",
      "tab",
      "textbox",
      "combobox",
      "slider",
      "spinbutton",
      "search",
      "searchbox",
      "gridcell",
      "rowheader",
      "columnheader",
      "treeitem",
      "switch",
      "menubar",
      "menu",
      "listbox",
      "tree",
      "grid",
      "application",
      "group",
      "radiogroup",
      "list",
      "row",
      "table",
      "tooltip",
      "dialog",
      "alertdialog",
      "document",
      "article",
      "feed",
      "figure",
      "img",
      "banner",
      "complementary",
      "contentinfo",
      "form",
      "main",
      "navigation",
      "region",
      "status",
      "timer",
    ];

    return interactiveRoles.includes(role);
  }

  // Tier 6: Visual/Structural Indicators

  /**
   * Check for icon-sized interactive elements
   * Detects 10-50px elements that might be icons with interactive attributes
   */
  private async checkIconElements(node: EnhancedDOMTreeNode): Promise<boolean> {
    // First check if element size is within icon range
    const size = await getElementSize(node, this.webContents, this.logger);
    if (!size) {
      return false;
    }

    const isIconSize =
      size.width >= SIZE_THRESHOLDS.MIN_ICON_SIZE &&
      size.width <= SIZE_THRESHOLDS.MAX_ICON_SIZE &&
      size.height >= SIZE_THRESHOLDS.MIN_ICON_SIZE &&
      size.height <= SIZE_THRESHOLDS.MAX_ICON_SIZE;

    if (!isIconSize) {
      return false;
    }

    // Check if element has interactive attributes
    return this.hasIconInteractiveAttributes(node);
  }

  /**
   * Check if an icon-sized element has interactive attributes
   */
  private hasIconInteractiveAttributes(node: EnhancedDOMTreeNode): boolean {
    if (!node.attributes) {
      return false;
    }

    // Check for event handlers
    for (const handler of EVENT_HANDLERS) {
      if (node.attributes[handler]) {
        return true;
      }
    }

    // Check for interactive ARIA roles
    const role = node.attributes.role?.toLowerCase();
    if (role && ["button", "link", "menuitem", "option"].includes(role)) {
      return true;
    }

    // Check for tabindex
    if (
      node.attributes.tabindex !== undefined &&
      node.attributes.tabindex !== null
    ) {
      return true;
    }

    // Check for icon-specific attributes and patterns
    return this.hasIconAttributesOrClasses(node);
  }

  /**
   * Check for icon-specific attributes and class patterns
   */
  private hasIconAttributesOrClasses(node: EnhancedDOMTreeNode): boolean {
    if (!node.attributes) {
      return false;
    }

    // Check for icon attributes
    for (const attr of ICON_ATTRIBUTES) {
      const value = node.attributes[attr];
      if (value && typeof value === "string") {
        const lowerValue = value.toLowerCase();

        // Check for interactive keywords in attributes
        const interactiveKeywords = [
          "click",
          "action",
          "button",
          "btn",
          "trigger",
          "toggle",
          "close",
          "open",
          "menu",
          "search",
          "filter",
          "play",
          "pause",
          "stop",
          "next",
          "prev",
          "back",
          "forward",
          "up",
          "down",
        ];

        for (const keyword of interactiveKeywords) {
          if (lowerValue.includes(keyword)) {
            return true;
          }
        }
      }
    }

    // Special check for class name patterns
    if (node.attributes.class) {
      const className = node.attributes.class.toLowerCase();
      for (const pattern of ICON_CLASS_PATTERNS) {
        if (className.includes(pattern)) {
          // Also ensure it has some interactive indication
          return this.hasInteractiveIndication(node);
        }
      }
    }

    return false;
  }

  /**
   * Check if element has basic interactive indications
   */
  private hasInteractiveIndication(node: EnhancedDOMTreeNode): boolean {
    if (!node.attributes) {
      return false;
    }

    // Check for any event handler
    for (const handler of EVENT_HANDLERS) {
      if (node.attributes[handler]) {
        return true;
      }
    }

    // Check for cursor pointer style
    if (node.snapshotNode?.cursorStyle === "pointer") {
      return true;
    }

    // Check for ARIA attributes that suggest interactivity
    const ariaProps = [
      "aria-label",
      "aria-role",
      "aria-pressed",
      "aria-expanded",
    ];
    for (const prop of ariaProps) {
      if (node.attributes[prop]) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check cursor style indicators
   * Uses cursor style as final fallback for detecting interactive elements
   */
  private checkCursorStyle(node: EnhancedDOMTreeNode): boolean {
    // Check if the element has pointer cursor style
    return node.snapshotNode?.cursorStyle === "pointer";
  }

  // Tier 7: Compound Control Detection

  /**
   * Check for compound controls
   * Detects complex form controls that should be virtualized
   */
  private async checkCompoundControls(
    node: EnhancedDOMTreeNode
  ): Promise<boolean> {
    if (!this.canVirtualize(node)) {
      return false;
    }

    // Build compound components for the element
    await this.addCompoundComponents(node);

    // Element is considered interactive if it has compound components
    return !!(node._compoundChildren && node._compoundChildren.length > 0);
  }

  // ==================== COMPOUND CONTROL DETECTION ====================

  /**
   * Check if element can be virtualized as a compound control
   */
  canVirtualize(node: EnhancedDOMTreeNode): boolean {
    if (!node.tag) return false;

    const tag = node.tag.toLowerCase();
    const inputType = node.attributes.type?.toLowerCase();
    const ariaRole = node.attributes.role?.toLowerCase();

    // Check input types
    if (
      tag === "input" &&
      inputType &&
      COMPOUND_INPUT_TYPES.includes(inputType)
    ) {
      return true;
    }

    // Check element tags
    if (COMPOUND_ELEMENT_TAGS.includes(tag)) {
      return true;
    }

    // Check ARIA roles
    if (ariaRole && COMPOUND_ARIA_ROLES.includes(ariaRole)) {
      return true;
    }

    return false;
  }

  /**
   * Main entry point for compound component detection
   * Adds virtual components to compound controls
   */
  async addCompoundComponents(node: EnhancedDOMTreeNode): Promise<void> {
    try {
      const tag = node.tag?.toLowerCase();

      // Initialize compound children array if needed
      if (!node._compoundChildren) {
        node._compoundChildren = [];
      }

      // Build compound components based on element type
      if (tag === "input") {
        await this.buildInputComponents(node);
      } else if (tag === "select") {
        await this.buildSelectComponents(node);
      } else if (tag === "details") {
        await this.buildDetailsComponents(node);
      } else if (tag === "audio" || tag === "video") {
        await this.buildMediaComponents(node);
      } else {
        // Handle ARIA roles for elements that don't match specific tags
        const ariaRole = node.attributes.role?.toLowerCase();
        if (ariaRole === "combobox") {
          await this.buildComboboxComponents(node);
        } else if (ariaRole === "slider") {
          await this.buildSliderComponents(node);
        } else if (ariaRole === "spinbutton") {
          await this.buildSpinbuttonComponents(node);
        } else if (ariaRole === "listbox") {
          await this.buildListboxComponents(node);
        }
      }

      this.logger.debug(
        `Added ${node._compoundChildren.length} compound components to ${tag} element`
      );
    } catch (error) {
      this.logger.warn(
        `Error adding compound components to node ${node.nodeId}:`,
        error
      );
    }
  }

  /**
   * Build compound components for input elements
   */
  private async buildInputComponents(node: EnhancedDOMTreeNode): Promise<void> {
    const inputType = node.attributes.type?.toLowerCase();
    if (!inputType || !COMPOUND_INPUT_TYPES.includes(inputType)) {
      return;
    }

    switch (inputType) {
      case "range":
        this.buildRangeComponents(node);
        break;
      case "number":
        this.buildNumberComponents(node);
        break;
      case "color":
        this.buildColorComponents(node);
        break;
      case "file":
        this.buildFileComponents(node);
        break;
    }
  }

  /**
   * Build components for range input (slider)
   */
  private buildRangeComponents(node: EnhancedDOMTreeNode): void {
    const min = this.safeParseNumber(node.attributes.min, 0.0);
    const max = this.safeParseNumber(node.attributes.max, 100.0);
    const value = this.safeParseNumber(node.attributes.value, (min + max) / 2);

    node._compoundChildren?.push({
      role: "slider",
      name: "Value",
      valuemin: min,
      valuemax: max,
      valuenow: value,
    });
  }

  /**
   * Build components for number input
   */
  private buildNumberComponents(node: EnhancedDOMTreeNode): void {
    node._compoundChildren?.push(
      { role: "button", name: "Increment" },
      { role: "button", name: "Decrement" },
      { role: "textbox", name: "Value" }
    );
  }

  /**
   * Build components for color input
   */
  private buildColorComponents(node: EnhancedDOMTreeNode): void {
    const value = node.attributes.value || "#000000";

    node._compoundChildren?.push(
      { role: "textbox", name: "Hex Value", valuenow: value },
      { role: "button", name: "Color Picker" }
    );
  }

  /**
   * Build components for file input
   */
  private buildFileComponents(node: EnhancedDOMTreeNode): void {
    const multiple = node.attributes.multiple !== undefined;

    // Extract current file selection state from AX tree
    let currentValue = "None"; // Default to explicit "None" string for clarity

    if (node.axNode && node.axNode.properties) {
      for (const prop of node.axNode.properties) {
        // Try valuetext first (human-readable display like "file.pdf")
        if (String(prop.name) === "valuetext" && prop.value) {
          const valueStr = String(prop.value).trim();
          if (
            valueStr &&
            valueStr.toLowerCase() !== "" &&
            valueStr.toLowerCase() !== "no file chosen" &&
            valueStr.toLowerCase() !== "no file selected"
          ) {
            currentValue = valueStr;
            break;
          }
        }
        // Also try 'value' property (may include full path)
        else if (String(prop.name) === "value" && prop.value) {
          const valueStr = String(prop.value).trim();
          if (valueStr) {
            // For file inputs, value might be a full path - extract just filename
            if (valueStr.includes("\\")) {
              currentValue = valueStr.split("\\").pop() || valueStr;
            } else if (valueStr.includes("/")) {
              currentValue = valueStr.split("/").pop() || valueStr;
            } else {
              currentValue = valueStr;
            }
            break;
          }
        }
      }
    }

    node._compoundChildren?.push(
      { role: "button", name: "Browse Files" },
      {
        role: "textbox",
        name: multiple ? "Files Selected" : "File Selected",
        valuenow: currentValue,
        readonly: true,
      }
    );
  }

  /**
   * Build components for select elements with enhanced browser-use matching
   */
  private async buildSelectComponents(
    node: EnhancedDOMTreeNode
  ): Promise<void> {
    const optionsInfo = await this.extractSelectOptions(node);
    if (!optionsInfo) {
      // Fallback: still create basic components for selects without options
      node._compoundChildren?.push({
        role: "button",
        name: "Dropdown Toggle",
      });
      node._compoundChildren?.push({
        role: "listbox",
        name: "Options",
        options_count: 0,
        first_options: [],
        valuenow: null,
      });
      return;
    }

    // Add dropdown toggle button (consistent with browser-use)
    node._compoundChildren?.push({
      role: "button",
      name: "Dropdown Toggle",
      valuenow: null,
      valuemin: null,
      valuemax: null,
    });

    // Add options listbox with enhanced information matching browser-use format
    const listBoxComponent: Record<string, unknown> = {
      role: "listbox",
      name: "Options",
      options_count: optionsInfo.count,
      first_options: optionsInfo.firstOptions,
      valuenow: null,
      valuemin: null,
      valuemax: null,
    };

    // Add format hint if present (matches browser-use optional format_hint)
    if (optionsInfo.formatHint) {
      listBoxComponent.format_hint = optionsInfo.formatHint;
    }

    node._compoundChildren?.push(listBoxComponent);
  }

  /**
   * Extract options from select element with enhanced browser-use capabilities
   * Includes recursive DOM traversal, proper text extraction, and advanced format detection
   */
  private async extractSelectOptions(node: EnhancedDOMTreeNode): Promise<{
    count: number;
    firstOptions: string[];
    formatHint?: string;
  } | null> {
    try {
      // Use CDP to get select options with sophisticated extraction
      const result = await sendCDPCommand(
        this.webContents,
        "Runtime.evaluate",
        {
          expression: `
            (function(nodeId) {
              const node = document.querySelector('[data-node-id="' + nodeId + '"]');
              if (!node || node.tagName !== 'SELECT') return null;

              const options = [];
              const optionValues = [];

              function extractOptionsRecursive(element) {
                // Handle option elements
                if (element.tagName.toLowerCase() === 'option') {
                  let optionValue = '';
                  if (element.hasAttribute('value')) {
                    optionValue = element.getAttribute('value').trim();
                  }

                  // Extract text from direct text nodes only
                  let optionText = '';
                  for (let child of element.childNodes) {
                    if (child.nodeType === Node.TEXT_NODE && child.nodeValue) {
                      optionText += child.nodeValue.trim() + ' ';
                    }
                  }
                  optionText = optionText.trim();

                  // Use text as value if no explicit value
                  if (!optionValue && optionText) {
                    optionValue = optionText;
                  }

                  if (optionText || optionValue) {
                    options.push({text: optionText, value: optionValue});
                    optionValues.push(optionValue);
                  }
                }
                // Handle optgroup elements
                else if (element.tagName.toLowerCase() === 'optgroup') {
                  for (let child of element.children) {
                    extractOptionsRecursive(child);
                  }
                }
                // Process other children
                else {
                  for (let child of element.children) {
                    extractOptionsRecursive(child);
                  }
                }
              }

              // Extract from select children
              for (let child of node.children) {
                extractOptionsRecursive(child);
              }

              if (options.length === 0) return null;

              // Build display options with ellipsis and truncation
              const firstOptions = [];
              for (let option of options.slice(0, 4)) {
                const displayText = option.text || option.value;
                if (displayText) {
                  const text = displayText.length > 30 ?
                    displayText.substring(0, 30) + '...' : displayText;
                  firstOptions.push(text);
                }
              }

              if (options.length > 4) {
                firstOptions.push('... ' + (options.length - 4) + ' more options...');
              }

              // Enhanced format detection matching browser-use
              let formatHint = undefined;
              if (optionValues.length >= 2) {
                const sampleValues = optionValues.slice(0, 5).filter(val => val);

                if (sampleValues.every(val => /^\\d+$/.test(val))) {
                  formatHint = 'numeric';
                }
                else if (sampleValues.every(val => /^[A-Z]{2}$/.test(val))) {
                  formatHint = 'country/state codes';
                }
                else if (sampleValues.every(val => /[\\/\\\\-]/.test(val))) {
                  formatHint = 'date/path format';
                }
                else if (sampleValues.some(val => /@/.test(val))) {
                  formatHint = 'email addresses';
                }
              }

              return {count: options.length, firstOptions, formatHint};
            })(${node.nodeId})
          `,
        },
        this.logger
      );

      return (
        (
          result as {
            result?: {
              value?: {
                count: number;
                firstOptions: string[];
                formatHint?: string;
              };
            };
          }
        )?.result?.value || null
      );
    } catch (error) {
      this.logger.warn(
        `Failed to extract select options for node ${node.nodeId}:`,
        error
      );
      return null;
    }
  }

  /**
   * Build components for details/summary elements
   */
  private buildDetailsComponents(node: EnhancedDOMTreeNode): void {
    const isOpen = node.attributes.open !== undefined;

    node._compoundChildren?.push(
      {
        role: "button",
        name: "Toggle Disclosure",
        valuenow: isOpen ? "open" : "closed",
      },
      {
        role: "region",
        name: "Content Area",
      }
    );
  }

  /**
   * Build components for media elements
   */
  private buildMediaComponents(node: EnhancedDOMTreeNode): void {
    const isVideo = node.tag === "video";

    node._compoundChildren?.push(
      { role: "button", name: "Play/Pause" },
      { role: "slider", name: "Progress", valuemin: 0, valuemax: 100 },
      { role: "button", name: "Mute" },
      { role: "slider", name: "Volume", valuemin: 0, valuemax: 100 }
    );

    if (isVideo) {
      node._compoundChildren?.push({ role: "button", name: "Fullscreen" });
    }
  }

  /**
   * Build components for combobox elements
   */
  private buildComboboxComponents(node: EnhancedDOMTreeNode): void {
    node._compoundChildren?.push(
      { role: "textbox", name: "Input" },
      { role: "button", name: "Dropdown Toggle" },
      { role: "listbox", name: "Options" }
    );
  }

  /**
   * Build components for ARIA slider elements
   */
  private buildSliderComponents(node: EnhancedDOMTreeNode): void {
    const min = this.safeParseNumber(node.attributes["aria-valuemin"], 0.0);
    const max = this.safeParseNumber(node.attributes["aria-valuemax"], 100.0);
    const value = this.safeParseNumber(
      node.attributes["aria-valuenow"],
      (min + max) / 2
    );

    node._compoundChildren?.push({
      role: "slider",
      name: "Value",
      valuemin: min,
      valuemax: max,
      valuenow: value,
    });
  }

  /**
   * Build components for ARIA spinbutton elements
   */
  private buildSpinbuttonComponents(node: EnhancedDOMTreeNode): void {
    const min = this.safeParseNumber(node.attributes["aria-valuemin"], 0.0);
    const max = this.safeParseNumber(node.attributes["aria-valuemax"], 100.0);
    const value = this.safeParseNumber(
      node.attributes["aria-valuenow"],
      (min + max) / 2
    );

    node._compoundChildren?.push(
      { role: "button", name: "Increment" },
      { role: "button", name: "Decrement" },
      {
        role: "textbox",
        name: "Value",
        valuemin: min,
        valuemax: max,
        valuenow: value,
      }
    );
  }

  /**
   * Build components for ARIA listbox elements
   */
  private buildListboxComponents(node: EnhancedDOMTreeNode): void {
    // Try to get option information from the node
    const optionsCount = this.safeParseNumber(
      node.attributes["aria-setsize"],
      0
    );

    node._compoundChildren?.push({
      role: "listbox",
      name: "Options",
      options_count: optionsCount > 0 ? optionsCount : null,
    });
  }

  /**
   * Safely parse a number with fallback
   */
  private safeParseNumber(value: string | undefined, fallback: number): number {
    if (!value) return fallback;
    const parsed = parseFloat(value);
    return isNaN(parsed) ? fallback : parsed;
  }

  // ==================== COMPOUND COMPONENT SERIALIZATION ====================

  /**
   * Format compound components as HTML attribute string for serialization
   */
  formatCompoundComponents(node: EnhancedDOMTreeNode): string {
    if (!node._compoundChildren || node._compoundChildren.length === 0) {
      return "";
    }

    const compoundInfo = node._compoundChildren.map(
      (childInfo: Record<string, unknown>) => {
        const parts: string[] = [];
        if (childInfo.name) parts.push(`name=${childInfo.name}`);
        if (childInfo.role) parts.push(`role=${childInfo.role}`);
        if (childInfo.valuemin !== undefined)
          parts.push(`min=${childInfo.valuemin}`);
        if (childInfo.valuemax !== undefined)
          parts.push(`max=${childInfo.valuemax}`);
        if (childInfo.valuenow !== undefined && childInfo.valuenow !== null) {
          parts.push(`current=${childInfo.valuenow}`);
        }
        if (childInfo.options_count)
          parts.push(`count=${childInfo.options_count}`);
        if (
          childInfo.first_options &&
          Array.isArray(childInfo.first_options) &&
          childInfo.first_options.length > 0
        ) {
          parts.push(
            `options=[${childInfo.first_options.slice(0, 3).join(", ")}]`
          );
        }
        if (childInfo.format_hint)
          parts.push(`format=${childInfo.format_hint}`);
        if (childInfo.readonly) parts.push(`readonly=true`);
        if (childInfo.description) parts.push(`desc=${childInfo.description}`);

        return `(${parts.join(",")})`;
      }
    );

    return `compound_components=${compoundInfo.join(",")}`;
  }

  /**
   * Get compound component summary for debugging
   */
  getCompoundComponentSummary(node: EnhancedDOMTreeNode): {
    count: number;
    types: string[];
    hasInteractiveComponents: boolean;
    summary: string;
  } {
    if (!node._compoundChildren || node._compoundChildren.length === 0) {
      return {
        count: 0,
        types: [],
        hasInteractiveComponents: false,
        summary: "No compound components",
      };
    }

    const types = node._compoundChildren.map(
      (child: Record<string, unknown>) => (child.role as string) || "unknown"
    );
    const interactiveRoles = ["button", "textbox", "slider", "listbox"];
    const hasInteractiveComponents = node._compoundChildren.some(
      (child: Record<string, unknown>) =>
        child.role && interactiveRoles.includes(child.role as string)
    );

    const summary = `${node._compoundChildren.length} components: ${types.join(
      ", "
    )}`;

    return {
      count: node._compoundChildren.length,
      types,
      hasInteractiveComponents,
      summary,
    };
  }

  /**
   * Check if node has compound components and is a compound control
   */
  isCompoundControl(node: EnhancedDOMTreeNode): boolean {
    return !!(node._compoundChildren && node._compoundChildren.length > 0);
  }

  /**
   * Get compound component detection tier info
   */
  getCompoundDetectionInfo(node: EnhancedDOMTreeNode): {
    isCompound: boolean;
    canVirtualize: boolean;
    componentCount: number;
    primaryType: string;
    detectionReason: string;
  } {
    const canVirtualize = this.canVirtualize(node);
    const isCompound = this.isCompoundControl(node);
    const componentCount = node._compoundChildren?.length || 0;
    const primaryType = this.getPrimaryCompoundType(node);
    const detectionReason = this.getCompoundDetectionReason(node);

    return {
      isCompound,
      canVirtualize,
      componentCount,
      primaryType,
      detectionReason,
    };
  }

  /**
   * Get the primary type of compound control
   */
  private getPrimaryCompoundType(node: EnhancedDOMTreeNode): string {
    if (!node._compoundChildren || node._compoundChildren.length === 0) {
      return "none";
    }

    const tag = node.tag?.toLowerCase();
    const inputType = node.attributes.type?.toLowerCase();

    if (tag === "input") {
      return inputType || "input";
    } else if (tag) {
      return tag;
    } else if (node.attributes.role) {
      return node.attributes.role;
    }

    return "unknown";
  }

  /**
   * Get the reason why this element was detected as compound control
   */
  private getCompoundDetectionReason(node: EnhancedDOMTreeNode): string {
    const tag = node.tag?.toLowerCase();
    const inputType = node.attributes.type?.toLowerCase();
    const ariaRole = node.attributes.role?.toLowerCase();

    if (
      tag === "input" &&
      inputType &&
      COMPOUND_INPUT_TYPES.includes(inputType)
    ) {
      return `Input type "${inputType}" requires virtualization`;
    } else if (COMPOUND_ELEMENT_TAGS.includes(tag || "")) {
      return `Element "${tag}" requires virtualization`;
    } else if (ariaRole && COMPOUND_ARIA_ROLES.includes(ariaRole)) {
      return `ARIA role "${ariaRole}" requires virtualization`;
    } else if (node._compoundChildren && node._compoundChildren.length > 0) {
      return `Has ${node._compoundChildren.length} virtual components`;
    }

    return "Unknown compound control";
  }
}
