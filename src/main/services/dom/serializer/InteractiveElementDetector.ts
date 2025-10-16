/**
 * Interactive Element Detector - Multi-layer scoring system
 *
 * Advanced detection system with 6 different detection strategies
 * following browser-use patterns for accurate interactive element identification.
 */

import type { EnhancedDOMTreeNode } from "@shared/dom";

/**
 * Interactive element detector with multi-layer scoring
 */
export class InteractiveElementDetector {
  // Interactive HTML tags (highest priority)
  private static readonly INTERACTIVE_TAGS = new Set([
    'button', 'input', 'select', 'textarea', 'a', 'details', 'summary',
    'iframe', 'object', 'embed', 'video', 'audio', 'canvas', 'area'
  ]);

  // Interactive ARIA roles
  private static readonly INTERACTIVE_ROLES = new Set([
    'button', 'link', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
    'option', 'tab', 'treeitem', 'gridcell', 'combobox', 'listbox',
    'textbox', 'checkbox', 'radio', 'slider', 'spinbutton'
  ]);

  // Interactive event handlers
  private static readonly INTERACTIVE_EVENTS = new Set([
    'onclick', 'onmousedown', 'onmouseup', 'onmouseover', 'onkeydown',
    'onkeyup', 'onkeypress', 'ontouchstart', 'ontouchend', 'onsubmit'
  ]);

  // Search element patterns
  private static readonly SEARCH_PATTERNS = [
    'search', 'magnify', 'find', 'query', 'filter', 'magnifying',
    'loupe', 'lookup'
  ];

  // Icon size range (in pixels)
  private static readonly ICON_SIZE_MIN = 10;
  private static readonly ICON_SIZE_MAX = 50;

  /**
   * Check if element is interactive using multi-layer detection
   * Returns score (0-100) and detailed detection info
   */
  static isInteractive(node: EnhancedDOMTreeNode): {
    isInteractive: boolean;
    score: number;
    detectionLayers: string[];
  } {
    const detectionLayers: string[] = [];
    let score = 0;

    // Layer 1: Interactive tags (highest priority)
    const tagScore = this.checkInteractiveTag(node);
    if (tagScore > 0) {
      score += tagScore;
      detectionLayers.push(`Tag: ${node.tag} (${tagScore})`);
    }

    // Layer 2: Accessibility roles and properties
    const axScore = this.checkAccessibilityProperties(node);
    if (axScore > 0) {
      score += axScore;
      detectionLayers.push(`Accessibility: ${axScore}`);
    }

    // Layer 3: Interactive attributes and event handlers
    const attrScore = this.checkInteractiveAttributes(node);
    if (attrScore > 0) {
      score += attrScore;
      detectionLayers.push(`Attributes: ${attrScore}`);
    }

    // Layer 4: Visual indicators (cursor styles, sizing)
    const visualScore = this.checkVisualIndicators(node);
    if (visualScore > 0) {
      score += visualScore;
      detectionLayers.push(`Visual: ${visualScore}`);
    }

    // Layer 5: Search element patterns
    const searchScore = this.checkSearchPatterns(node);
    if (searchScore > 0) {
      score += searchScore;
      detectionLayers.push(`Search: ${searchScore}`);
    }

    // Layer 6: Icon-sized elements with interactive properties
    const iconScore = this.checkIconElements(node);
    if (iconScore > 0) {
      score += iconScore;
      detectionLayers.push(`Icon: ${iconScore}`);
    }

    // Special handling for iframes
    if (this.isInteractiveIframe(node)) {
      score += 60;
      detectionLayers.push('Interactive iframe');
    }

    return {
      isInteractive: score >= 30, // Threshold for interactivity
      score,
      detectionLayers
    };
  }

  /**
   * Check for interactive HTML tags
   */
  private static checkInteractiveTag(node: EnhancedDOMTreeNode): number {
    if (!node.tag) return 0;

    const tag = node.tag.toLowerCase();
    if (this.INTERACTIVE_TAGS.has(tag)) {
      // Base score for interactive tags
      let score = 70;

      // Bonus for form elements with proper attributes
      if (['input', 'select', 'textarea'].includes(tag)) {
        if (node.attributes.type && node.attributes.type !== 'hidden') {
          score += 15;
        }
        if (node.attributes.name) {
          score += 10;
        }
      }

      // Bonus for links with href
      if (tag === 'a' && node.attributes.href) {
        score += 20;
      }

      return score;
    }

    return 0;
  }

  /**
   * Check for accessibility properties that indicate interactivity
   */
  private static checkAccessibilityProperties(node: EnhancedDOMTreeNode): number {
    if (!node.axNode) return 0;

    let score = 0;

    // Check for interactive roles
    if (node.axNode.role && this.INTERACTIVE_ROLES.has(node.axNode.role)) {
      score += 80;
    }

    // Check for accessibility properties
    if (node.axNode.properties) {
      for (const prop of node.axNode.properties) {
        switch (prop.name) {
          case 'focusable':
            if (prop.value === true) score += 50;
            break;
          case 'editable':
            if (prop.value === true) score += 60;
            break;
          case 'settable':
            if (prop.value === true) score += 40;
            break;
          case 'checked':
          case 'selected':
            if (prop.value === true) score += 30;
            break;
          case 'haspopup':
            if (prop.value === true) score += 40;
            break;
          case 'required':
            if (prop.value === true) score += 20;
            break;
          case 'disabled':
            if (prop.value === true) score -= 100; // Heavily penalize disabled
            break;
        }
      }
    }

    // Check for meaningful accessible name
    if (node.axNode.name && node.axNode.name.trim().length > 0) {
      score += 20;
    }

    return Math.max(0, score);
  }

  /**
   * Check for interactive attributes and event handlers
   */
  private static checkInteractiveAttributes(node: EnhancedDOMTreeNode): number {
    let score = 0;

    // Check for event handlers
    for (const [attr, value] of Object.entries(node.attributes)) {
      // Event handlers
      if (this.INTERACTIVE_EVENTS.has(attr.toLowerCase()) && value) {
        score += 40;
      }

      // Interactive attributes
      switch (attr.toLowerCase()) {
        case 'tabindex':
          if (value !== '0' && value !== '-1') {
            score += 30;
          }
          break;
        case 'role':
          if (this.INTERACTIVE_ROLES.has(value)) {
            score += 50;
          }
          break;
        case 'contenteditable':
          if (value === 'true') {
            score += 60;
          }
          break;
        case 'draggable':
          if (value === 'true') {
            score += 25;
          }
          break;
        case 'autocorrect':
        case 'autocomplete':
          if (value && value !== 'off') {
            score += 15;
          }
          break;
      }
    }

    return score;
  }

  /**
   * Check for visual indicators of interactivity
   */
  private static checkVisualIndicators(node: EnhancedDOMTreeNode): number {
    let score = 0;

    // Check cursor style
    if (node.snapshotNode?.cursorStyle === 'pointer') {
      score += 50;
    }

    // Check for CSS pointer events
    if (node.snapshotNode?.computedStyles) {
      const computedStyles = node.snapshotNode.computedStyles;

      if (computedStyles['pointer-events'] !== 'none') {
        score += 20;
      }

      // Check for visible elements with interactive styling
      if (node.isVisible !== false) {
        // Elements with borders that might be interactive
        if (computedStyles['border'] && computedStyles['border'] !== 'none') {
          score += 10;
        }

        // Elements with background that might be buttons
        if (computedStyles['background-color'] &&
            computedStyles['background-color'] !== 'transparent' &&
            computedStyles['background-color'] !== 'rgba(0, 0, 0, 0)') {
          score += 15;
        }
      }
    }

    return score;
  }

  /**
   * Check for search element patterns
   */
  private static checkSearchPatterns(node: EnhancedDOMTreeNode): number {
    const searchText = [
      node.attributes.id,
      node.attributes.class,
      node.attributes['data-testid'],
      node.attributes['data-cy'],
      node.axNode?.name,
      node.axNode?.description
    ].filter(Boolean).join(' ').toLowerCase();

    let score = 0;
    for (const pattern of this.SEARCH_PATTERNS) {
      if (searchText.includes(pattern)) {
        score += 35;
        break;
      }
    }

    return score;
  }

  /**
   * Check for icon-sized elements with interactive properties
   */
  private static checkIconElements(node: EnhancedDOMTreeNode): number {
    if (!node.snapshotNode?.bounds) return 0;

    const bounds = node.snapshotNode.bounds;
    const width = bounds.width;
    const height = bounds.height;

    // Check if element is icon-sized
    const isIconSized = width >= this.ICON_SIZE_MIN && width <= this.ICON_SIZE_MAX &&
                       height >= this.ICON_SIZE_MIN && height <= this.ICON_SIZE_MAX;

    if (!isIconSized) return 0;

    // Check for interactive properties on icon-sized elements
    let score = 0;

    // Has tooltip or title
    if (node.attributes.title || node.attributes['aria-label']) {
      score += 30;
    }

    // Has click handler
    for (const attr of Object.keys(node.attributes)) {
      if (attr.startsWith('on') && this.INTERACTIVE_EVENTS.has(attr.toLowerCase())) {
        score += 40;
        break;
      }
    }

    // SVG elements are often interactive icons
    if (node.tag === 'svg' || node.tag === 'path' || node.tag === 'use') {
      score += 25;
    }

    return score;
  }

  /**
   * Special handling for iframes
   */
  private static isInteractiveIframe(node: EnhancedDOMTreeNode): boolean {
    if (node.tag !== 'iframe') return false;

    // Check if iframe has meaningful content
    if (!node.snapshotNode?.bounds) return false;

    const bounds = node.snapshotNode.bounds;

    // Must be larger than 100x100 to be considered interactive
    if (bounds.width < 100 || bounds.height < 100) {
      return false;
    }

    // Check if iframe has src or content document
    if (node.attributes.src || node.contentDocument) {
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
      properties?: Array<{name: string; value: unknown}>;
    };
    visual: {
      cursor?: string;
      isVisible?: boolean;
      bounds?: {width: number; height: number};
    };
    detection: ReturnType<typeof InteractiveElementDetector.isInteractive>;
  } {
    return {
      tagName: node.tag || 'unknown',
      attributes: node.attributes,
      accessibility: {
        role: node.axNode?.role || undefined,
        name: node.axNode?.name || undefined,
        properties: node.axNode?.properties || []
      },
      visual: {
        cursor: node.snapshotNode?.cursorStyle,
        isVisible: node.isVisible || false,
        bounds: node.snapshotNode?.bounds ? {
          width: node.snapshotNode.bounds.width,
          height: node.snapshotNode.bounds.height
        } : undefined
      },
      detection: this.isInteractive(node)
    };
  }
}