import { WebContents } from "electron";
import { createHash } from "crypto";
import type {
  DOMElementNode,
  DOMTextNode,
  DOMNode,
  SelectorMap,
  DOMState,
  DOMStateDiff,
  BuildDomTreeArgs,
  JSNodeData,
  JSEvalResult,
  ViewportInfo,
  PageInfo,
  HashedDomElement,
  CoordinateSet,
} from "@shared/index";
import { getIndexScript } from "@/scripts/indexLoader";

// Result of DOM extraction and manipulation operations
interface DOMExtractionResult {
  success: boolean;
  data?: unknown;
  error?: string;
  extractedContent?: string;
  screenshot?: Buffer;
}

const DEFAULT_INCLUDE_ATTRIBUTES = [
  "title",
  "type",
  "checked",
  "name",
  "role",
  "value",
  "placeholder",
  "data-date-format",
  "alt",
  "aria-label",
  "aria-expanded",
  "data-state",
  "aria-checked",
];

/**
 * DomService provides comprehensive DOM analysis and manipulation capabilities for web automation.
 * It enables extraction of interactive elements, page information, element hashing for tracking changes,
 * and DOM state comparison.
 *
 * The service orchestrates DOM analysis by:
 * 1. Executing JavaScript in the page context to extract DOM structure
 * 2. Constructing TypeScript representations of the DOM
 * 3. Providing utilities for element hashing and change tracking
 * 4. Converting DOM structures to LLM-optimized string representations
 */
export class DomService {
  /** Electron WebContents object for the target web page */
  private webContents: WebContents;

  /** Logger instance for debugging and error tracking */
  private logger: Console = console;

  /** Cache of element hashes organized by URL for change tracking */
  private cachedElementHashes: Map<string, Set<string>> = new Map();

  /**
   * Creates a new DomService instance
   * @param webContents - Electron WebContents object for the target web page
   */
  constructor(webContents: WebContents) {
    this.webContents = webContents;
  }

  // ==================== Public API Methods ====================

  /**
   * Extracts clickable/interactive elements from the current page DOM and returns structured representation.
   * This method orchestrates the complete DOM analysis process by executing JavaScript in the page context
   * and constructing a TypeScript representation of the DOM tree.
   *
   * @param highlightElements - Whether to visually highlight elements on the page (default: true)
   * @param focusElement - Index of element to focus specifically (default: -1, no focus)
   * @param viewportExpansion - Additional area around viewport to include (default: 0)
   * @returns Promise resolving to DOMState containing elementTree and selectorMap
   *
   * @example
   * const domState = await domService.getClickableElements(true, 5, 100);
   * console.log(domState.elementTree); // DOM hierarchy
   * console.log(domState.selectorMap); // Index to element mapping
   */
  async getClickableElements(
    highlightElements: boolean = true,
    focusElement: number = -1,
    viewportExpansion: number = 0
  ): Promise<DOMState> {
    const { elementTree, selectorMap } = await this._buildDomTree(
      highlightElements,
      focusElement,
      viewportExpansion
    );
    return { elementTree, selectorMap };
  }

  /**
   * Converts structured DOM elements to a human-readable string representation optimized for LLM consumption.
   * This method processes the DOM tree and creates a formatted text representation that includes element
   * tags, attributes, and text content with proper indentation and highlighting indicators.
   *
   * @param rootNode - DOMElementNode to convert to string representation
   * @param includeAttributes - Array of attribute names to include. Uses DEFAULT_INCLUDE_ATTRIBUTES if null.
   * @returns Formatted text representation of elements optimized for LLM consumption
   *
   * @example
   * const elementsString = domService.clickableElementsToString(domState.elementTree);
   * console.log(elementsString); // Formatted text representation
   */
  clickableElementsToString(
    rootNode: DOMElementNode,
    includeAttributes: string[] | null = null
  ): string {
    const formattedText: string[] = [];

    if (!includeAttributes) {
      includeAttributes = DEFAULT_INCLUDE_ATTRIBUTES;
    }

    const processNode = (node: DOMNode, depth: number): void => {
      let nextDepth = depth;
      const depthStr = "\t".repeat(depth);

      if (node.type === "ELEMENT_NODE") {
        // Add element with highlight_index
        if (node.highlightIndex !== null && node.highlightIndex !== undefined) {
          nextDepth += 1;

          const text = this.getAllTextTillNextClickableElement(node);
          let attributesHtmlStr: string | null = null;

          if (includeAttributes) {
            const attributesToInclude: Record<string, string> = {};

            // Filter attributes
            for (const [key, value] of Object.entries(node.attributes)) {
              if (includeAttributes.includes(key) && value.trim() !== "") {
                attributesToInclude[key] = value.trim();
              }
            }

            // Remove duplicate attribute values (optimization from browser-use)
            const orderedKeys = includeAttributes.filter(
              (key) => key in attributesToInclude
            );
            if (orderedKeys.length > 1) {
              const keysToRemove = new Set<string>();
              const seenValues: Record<string, string> = {};

              for (const key of orderedKeys) {
                const value = attributesToInclude[key];
                if (value.length > 5) {
                  // Don't remove short values like "true", "false"
                  if (value in seenValues) {
                    keysToRemove.add(key);
                  } else {
                    seenValues[value] = key;
                  }
                }
              }

              for (const key of keysToRemove) {
                delete attributesToInclude[key];
              }
            }

            // Easy LLM optimizations
            // If tag == role attribute, don't include it
            if (node.tagName === attributesToInclude.role) {
              delete attributesToInclude.role;
            }

            // Remove attributes that duplicate the node's text content
            const attrsToRemoveIfTextMatches = [
              "aria-label",
              "placeholder",
              "title",
            ];
            for (const attr of attrsToRemoveIfTextMatches) {
              if (
                attributesToInclude[attr] &&
                attributesToInclude[attr].trim().toLowerCase() ===
                  text.trim().toLowerCase()
              ) {
                delete attributesToInclude[attr];
              }
            }

            if (Object.keys(attributesToInclude).length > 0) {
              // Format as key1='value1' key2='value2'
              attributesHtmlStr = Object.entries(attributesToInclude)
                .map(
                  ([key, value]) => `${key}=${this.capTextLength(value, 15)}`
                )
                .join(" ");
            }
          }

          // Build the line
          const highlightIndicator = node.isNew
            ? `*[${node.highlightIndex}]`
            : `[${node.highlightIndex}]`;
          let line = `${depthStr}${highlightIndicator}<${node.tagName}`;

          if (attributesHtmlStr) {
            line += ` ${attributesHtmlStr}`;
          }

          if (text) {
            // Add space before >text only if there were NO attributes added before
            const trimmedText = text.trim();
            if (!attributesHtmlStr) {
              line += " ";
            }
            line += `>${trimmedText}`;
          } else if (!attributesHtmlStr) {
            // Add space before /> only if neither attributes NOR text were added
            line += " ";
          }

          line += " />";
          formattedText.push(line);
        }

        // Process children regardless
        for (const child of node.children) {
          processNode(child, nextDepth);
        }
      } else if (node.type === "TEXT_NODE") {
        // Add text only if it doesn't have a highlighted parent
        if (this.hasParentWithHighlightIndex(node)) {
          return;
        }

        if (node.parent && node.parent.isVisible && node.parent.isTopElement) {
          formattedText.push(`${depthStr}${node.text}`);
        }
      }
    };

    processNode(rootNode, 0);
    return formattedText.join("\n");
  }

  /**
   * Retrieves comprehensive information about the current page including dimensions and scroll position.
   * This method executes JavaScript in the page context to extract viewport dimensions, page dimensions,
   * and current scroll position, then calculates additional context like pixels above/below/left/right.
   *
   * @returns Promise resolving to PageInfo object containing page dimensions and scroll information
   *
   * @example
   * const pageInfo = await domService.getPageInfo();
   * console.log(pageInfo.viewportWidth, pageInfo.viewportHeight); // Viewport dimensions
   * console.log(pageInfo.scrollY); // Current vertical scroll position
   *
   * @example
   * const pageInfo = await domService.getPageInfo();
   * if (pageInfo.pixelsBelow > 0) {
   *   console.log('Page has content below the viewport');
   * }
   */
  async getPageInfo(): Promise<PageInfo> {
    try {
      const pageData = await this.webContents.executeJavaScript(`
        (() => {
          return {
            // Viewport dimensions
            viewportWidth: window.innerWidth || document.documentElement.clientWidth,
            viewportHeight: window.innerHeight || document.documentElement.clientHeight,
            
            // Page dimensions
            pageWidth: Math.max(
              document.body ? document.body.scrollWidth : 0,
              document.body ? document.body.offsetWidth : 0,
              document.documentElement.clientWidth,
              document.documentElement.scrollWidth,
              document.documentElement.offsetWidth
            ),
            pageHeight: Math.max(
              document.body ? document.body.scrollHeight : 0,
              document.body ? document.body.offsetHeight : 0,
              document.documentElement.clientHeight,
              document.documentElement.scrollHeight,
              document.documentElement.offsetHeight
            ),
            
            // Current scroll position
            scrollX: window.scrollX || window.pageXOffset || document.documentElement.scrollLeft || 0,
            scrollY: window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0
          };
        })()
      `);

      const viewportWidth = Math.floor(pageData.viewportWidth);
      const viewportHeight = Math.floor(pageData.viewportHeight);
      const pageWidth = Math.floor(pageData.pageWidth);
      const pageHeight = Math.floor(pageData.pageHeight);
      const scrollX = Math.floor(pageData.scrollX);
      const scrollY = Math.floor(pageData.scrollY);

      // Calculate scroll information
      const pixelsAbove = scrollY;
      const pixelsBelow = Math.max(0, pageHeight - (scrollY + viewportHeight));
      const pixelsLeft = scrollX;
      const pixelsRight = Math.max(0, pageWidth - (scrollX + viewportWidth));

      return {
        viewportWidth,
        viewportHeight,
        pageWidth,
        pageHeight,
        scrollX,
        scrollY,
        pixelsAbove,
        pixelsBelow,
        pixelsLeft,
        pixelsRight,
      };
    } catch (error) {
      this.logger.error("Failed to get page info:", error);
      // Return default values on error
      return {
        viewportWidth: 1280,
        viewportHeight: 720,
        pageWidth: 1280,
        pageHeight: 720,
        scrollX: 0,
        scrollY: 0,
        pixelsAbove: 0,
        pixelsBelow: 0,
        pixelsLeft: 0,
        pixelsRight: 0,
      };
    }
  }

  /**
   * Executes the DOM tree building function in the page context to extract the page structure.
   * This method runs the buildDomTree JavaScript function (injected via index.js) with the specified
   * arguments to analyze the page DOM and return the results.
   *
   * @param args - Partial BuildDomTreeArgs with options for DOM extraction
   * @returns Promise resolving to DOMExtractionResult with success/failure status and extracted data
   *
   * @example
   * const result = await domService.buildDomTree({
   *   doHighlightElements: true,
   *   focusHighlightIndex: 3
   * });
   * if (result.success) {
   *   console.log(result.data); // Extracted DOM data
   * }
   */
  async buildDomTree(
    args?: Partial<BuildDomTreeArgs>
  ): Promise<DOMExtractionResult> {
    const defaultArgs: BuildDomTreeArgs = {
      doHighlightElements: false,
      focusHighlightIndex: -1,
      viewportExpansion: 0,
      debugMode: true,
    };

    const finalArgs = { ...defaultArgs, ...args };
    try {
      // Execute the buildDomTree function from the injected index.js
      const script = `
        (function() {
          if (typeof buildDomTree === 'function') {
            return buildDomTree(${JSON.stringify(finalArgs)});
          } else {
            throw new Error('buildDomTree function not found. Make sure index.js is injected.');
          }
        })()
      `;

      const result = await this.webContents.executeJavaScript(script);
      return { success: true, data: result };
    } catch (error) {
      // If the function is not found, try to inject the script and retry
      if (
        error instanceof Error &&
        error.message.includes("buildDomTree function not found")
      ) {
        try {
          // Inject the script as a fallback
          const indexScript = getIndexScript();
          const wrappedIndexScript = `
            (function() {
              window.buildDomTree = ${indexScript};
            })();
          `;
          await this.webContents.executeJavaScript(wrappedIndexScript);

          // Retry the buildDomTree execution
          const retryScript = `
            (function() {
              if (typeof buildDomTree === 'function') {
                buildDomTree(${JSON.stringify(finalArgs)});
              } else {
                throw new Error('buildDomTree function still not found after injection.');
              }
            })()
          `;

          const result = await this.webContents.executeJavaScript(retryScript);
          return { success: true, data: result };
        } catch (injectionError) {
          return {
            success: false,
            error:
              injectionError instanceof Error
                ? injectionError.message
                : "Failed to build DOM tree even after script injection",
          };
        }
      }

      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to build DOM tree",
      };
    }
  }

  // ==================== Element Hashing & Fingerprinting ====================

  /**
   * Creates a unique hash fingerprint for a DOM element based on its attributes, path, and xpath.
   * This method generates a combined hash from the element's branch path, attributes, and xpath
   * to create a unique fingerprint for change tracking and element identification.
   *
   * @param element - DOMElementNode to hash
   * @returns Combined hash of branch path, attributes, and xpath
   *
   * @example
   * const elementHash = domService.hashDomElement(element);
   * console.log(elementHash); // Unique fingerprint for the element
   */
  hashDomElement(element: DOMElementNode): string {
    const hashedElement = this._hashDomElementToComponents(element);
    return `${hashedElement.branchPathHash}-${hashedElement.attributesHash}-${hashedElement.xpathHash}`;
  }

  /**
   * Breaks down a DOM element into components for hashing (internal use).
   * This private method extracts the branch path, attributes, and xpath from an element
   * and creates individual hashes for each component.
   *
   * @param element - DOMElementNode to break down into hashable components
   * @returns HashedDomElement containing individual hashes for each component
   *
   * @example
   * const hashedElement = domService._hashDomElementToComponents(element);
   * console.log(hashedElement.branchPathHash); // Hash of element's path in DOM tree
   * console.log(hashedElement.attributesHash); // Hash of element's attributes
   * console.log(hashedElement.xpathHash); // Hash of element's xpath
   */
  private _hashDomElementToComponents(
    element: DOMElementNode
  ): HashedDomElement {
    const parentBranchPath = this._getParentBranchPath(element);
    const branchPathHash = this._hashString(parentBranchPath.join("/"));
    const attributesHash = this._hashString(
      Object.entries(element.attributes)
        .map(([key, value]) => `${key}=${value}`)
        .join("")
    );
    const xpathHash = this._hashString(element.xpath);

    return {
      branchPathHash,
      attributesHash,
      xpathHash,
    };
  }

  /**
   * Extracts hash fingerprints for all clickable elements in a DOM tree.
   * This method traverses the DOM tree and generates unique hashes for all elements
   * that have a highlightIndex (i.e., clickable/interactive elements).
   *
   * @param rootElement - DOMElementNode root to traverse
   * @returns Set of unique hashes for all clickable elements
   *
   * @example
   * const hashes = domService.getClickableElementHashes(rootElement);
   * console.log(hashes.size); // Number of clickable elements
   */
  getClickableElementHashes(rootElement: DOMElementNode): Set<string> {
    const hashes = new Set<string>();

    const processNode = (node: DOMElementNode): void => {
      if (node.highlightIndex !== null && node.highlightIndex !== undefined) {
        const hash = this.hashDomElement(node);
        hashes.add(hash);
      }

      for (const child of node.children) {
        if (child.type === "ELEMENT_NODE") {
          processNode(child);
        }
      }
    };

    processNode(rootElement);
    return hashes;
  }

  /**
   * Updates internal cache of element hashes and marks new elements as "isNew".
   * This method compares the current elements on a page with previously cached elements
   * to identify new elements and update the cache for future comparisons.
   *
   * @param url - Page URL for cache identification
   * @param rootElement - DOMElementNode root to analyze
   *
   * @example
   * domService.updateElementCache(window.location.href, rootElement);
   * // rootElement and its children now have isNew and elementHash properties set
   */
  updateElementCache(url: string, rootElement: DOMElementNode): void {
    const currentHashes = this.getClickableElementHashes(rootElement);
    const cachedHashes = this.cachedElementHashes.get(url) || new Set();

    // Mark new elements
    const markNewElements = (node: DOMElementNode): void => {
      if (node.highlightIndex !== null && node.highlightIndex !== undefined) {
        const hash = this.hashDomElement(node);
        node.isNew = !cachedHashes.has(hash);
        // Also set the hash on the element
        node.elementHash = hash;
      }

      for (const child of node.children) {
        if (child.type === "ELEMENT_NODE") {
          markNewElements(child);
        }
      }
    };

    markNewElements(rootElement);

    // Update cache
    this.cachedElementHashes.set(url, currentHashes);
  }

  /**
   * Clears the element hash cache for a specific URL or all URLs.
   * This method is useful for memory management and when navigating to entirely
   * different pages where cached element hashes are no longer relevant.
   *
   * @param url - Specific URL to clear, or clears all if undefined
   *
   * @example
   * domService.clearElementCache(); // Clear all cached hashes
   * domService.clearElementCache('https://example.com'); // Clear specific URL
   */
  clearElementCache(url?: string): void {
    if (url) {
      this.cachedElementHashes.delete(url);
    } else {
      this.cachedElementHashes.clear();
    }
  }

  // ==================== DOM State Diffing ====================

  /**
   * Compares two DOM states to identify added, removed, or modified elements.
   * This method is essential for tracking changes in page state over time by
   * comparing element hashes between two DOM states.
   *
   * @param previous - Previous DOMState to compare
   * @param current - Current DOMState to compare
   * @returns DOMStateDiff containing lists of added, removed, modified, and unchanged elements
   *
   * @example
   * const diff = domService.compareDOMStates(previousState, currentState);
   * console.log(`Added: ${diff.addedElements.length}`);
   * console.log(`Removed: ${diff.removedElements.length}`);
   *
   * @example
   * const diff = domService.compareDOMStates(previousState, currentState);
   * if (diff.addedElements.length > 0) {
   *   console.log('New elements detected on page');
   *   // Process newly added elements
   *   diff.addedElements.forEach(element => {
   *     console.log(`New element: ${element.tagName} with highlight index ${element.highlightIndex}`);
   *   });
   * }
   */
  compareDOMStates(previous: DOMState, current: DOMState): DOMStateDiff {
    const diff: DOMStateDiff = {
      addedElements: [],
      removedElements: [],
      modifiedElements: [],
      unchangedElements: [],
    };

    // Get all elements with highlightIndex from both states
    const previousElements = this._getAllHighlightedElements(
      previous.elementTree
    );
    const currentElements = this._getAllHighlightedElements(
      current.elementTree
    );

    // Create maps for easier lookup
    const previousMap = new Map<string, DOMElementNode>();
    const currentMap = new Map<string, DOMElementNode>();

    previousElements.forEach((el) => {
      const hash = this.hashDomElement(el);
      previousMap.set(hash, el);
    });

    currentElements.forEach((el) => {
      const hash = this.hashDomElement(el);
      currentMap.set(hash, el);
    });

    // Find removed elements (in previous but not in current)
    previousMap.forEach((element, hash) => {
      if (!currentMap.has(hash)) {
        diff.removedElements.push(element);
      }
    });

    // Find added and unchanged elements
    currentMap.forEach((element, hash) => {
      if (!previousMap.has(hash)) {
        diff.addedElements.push(element);
      } else {
        diff.unchangedElements.push(element);
      }
    });

    return diff;
  }

  /**
   * Extracts all elements with highlightIndex from a DOM tree (internal use).
   * This private helper method traverses a DOM tree and collects all elements
   * that have a highlightIndex property, which indicates they are interactive/clickable.
   *
   * @param root - DOMElementNode root to traverse
   * @returns Array of DOMElementNode objects with highlightIndex
   */
  private _getAllHighlightedElements(root: DOMElementNode): DOMElementNode[] {
    const elements: DOMElementNode[] = [];

    const collect = (node: DOMElementNode): void => {
      if (node.highlightIndex !== null && node.highlightIndex !== undefined) {
        elements.push(node);
      }

      for (const child of node.children) {
        if (child.type === "ELEMENT_NODE") {
          collect(child);
        }
      }
    };

    collect(root);
    return elements;
  }

  // ==================== Private Helper Methods ====================

  /**
   * Internal method that orchestrates the DOM analysis process by executing JavaScript
   * in the page context and constructing the TypeScript DOM tree.
   * This method is the core implementation behind getClickableElements().
   *
   * @param highlightElements - Whether to visually highlight elements on the page
   * @param focusElement - Index of element to focus specifically
   * @param viewportExpansion - Additional area around viewport to include
   * @returns Promise resolving to object containing elementTree and selectorMap
   */
  private async _buildDomTree(
    highlightElements: boolean,
    focusElement: number,
    viewportExpansion: number
  ): Promise<{ elementTree: DOMElementNode; selectorMap: SelectorMap }> {
    // Check if JavaScript can be evaluated
    try {
      const testResult = await this.webContents.executeJavaScript("1+1");
      if (testResult !== 2) {
        throw new Error("The page cannot evaluate javascript code properly");
      }
    } catch (_error) {
      throw new Error("The page cannot evaluate javascript code properly");
    }

    // Short-circuit for new tab pages
    const currentUrl = this.webContents.getURL();

    // Prepare arguments for JavaScript execution
    const debugMode = true; // Can be made configurable
    const args: BuildDomTreeArgs = {
      doHighlightElements: highlightElements,
      focusHighlightIndex: focusElement,
      viewportExpansion: viewportExpansion,
      debugMode: debugMode,
    };

    try {
      this.logger.debug(
        `🔧 Starting JavaScript DOM analysis for ${currentUrl.substring(
          0,
          50
        )}...`
      );

      // Execute buildDomTree with the provided arguments
      const result = await this.buildDomTree(args);

      if (!result.success || !result.data) {
        throw new Error(result.error || "Failed to build DOM tree");
      }

      const evalPage = result.data as JSEvalResult;
      this.logger.debug("✅ JavaScript DOM analysis completed");

      // Log performance metrics if available
      if (debugMode && evalPage.perfMetrics) {
        this.logPerformanceMetrics(currentUrl, evalPage);
      }

      this.logger.debug("🔄 Starting TypeScript DOM tree construction...");
      const domResult = await this._constructDomTree(evalPage);
      this.logger.debug("✅ TypeScript DOM tree construction completed");

      return domResult;
    } catch (error) {
      this.logger.error("Error evaluating JavaScript:", error);
      throw error;
    }
  }

  /**
   * Transforms JavaScript evaluation results into TypeScript DOM structures.
   * This method takes the raw JavaScript data from page execution and converts
   * it into structured TypeScript objects representing the DOM.
   *
   * @param evalPage - JSEvalResult from JavaScript execution
   * @returns Promise resolving to object containing elementTree and selectorMap
   */
  private async _constructDomTree(
    evalPage: JSEvalResult
  ): Promise<{ elementTree: DOMElementNode; selectorMap: SelectorMap }> {
    const jsNodeMap = evalPage.map;
    const jsRootId = evalPage.rootId;

    const selectorMap: SelectorMap = {};
    const nodeMap: Map<string, DOMNode> = new Map();

    // First pass: create all nodes
    for (const [id, nodeData] of Object.entries(jsNodeMap)) {
      const { node } = this._parseNode(nodeData);
      if (node === null) {
        continue;
      }

      nodeMap.set(id, node);

      // Build selector map for interactive elements
      if (
        node.type === "ELEMENT_NODE" &&
        node.highlightIndex !== null &&
        node.highlightIndex !== undefined
      ) {
        selectorMap[node.highlightIndex] = node;
      }
    }

    // Second pass: build parent-child relationships
    for (const [id, nodeData] of Object.entries(jsNodeMap)) {
      const node = nodeMap.get(id);
      if (!node || node.type !== "ELEMENT_NODE") {
        continue;
      }

      const childrenIds = (nodeData as JSNodeData).children || [];
      for (const childId of childrenIds) {
        const childNode = nodeMap.get(childId);
        if (!childNode) {
          continue;
        }

        childNode.parent = node;
        node.children.push(childNode);
      }
    }

    const rootNode = nodeMap.get(String(jsRootId));

    if (!rootNode || rootNode.type !== "ELEMENT_NODE") {
      throw new Error("Failed to parse HTML to dictionary");
    }

    return { elementTree: rootNode, selectorMap };
  }

  /**
   * Parses individual nodes from JavaScript data structures into TypeScript representations.
   * This method handles conversion of both element nodes and text nodes from their JavaScript
   * representation to TypeScript objects with appropriate properties.
   *
   * @param nodeData - JSNodeData from JavaScript execution
   * @returns Object containing parsed node and child IDs
   */
  private _parseNode(nodeData: JSNodeData): {
    node: DOMNode | null;
    childrenIds: string[];
  } {
    if (!nodeData) {
      return { node: null, childrenIds: [] };
    }

    // Process text nodes
    if (nodeData.type === "TEXT_NODE") {
      const textNode: DOMTextNode = {
        type: "TEXT_NODE",
        text: nodeData.text || "",
        isVisible: nodeData.isVisible || false,
        parent: null,
      };
      return { node: textNode, childrenIds: [] };
    }

    // Process element nodes
    let viewportInfo: ViewportInfo | undefined;

    if (nodeData.viewport) {
      viewportInfo = {
        width: nodeData.viewport.width,
        height: nodeData.viewport.height,
        scrollX: nodeData.viewport.scrollX,
        scrollY: nodeData.viewport.scrollY,
      };
    }

    // Process coordinate information
    let viewportCoordinates: CoordinateSet | undefined;
    let pageCoordinates: CoordinateSet | undefined;

    if (nodeData.viewportCoordinates) {
      viewportCoordinates = {
        topLeft: {
          x: nodeData.viewportCoordinates.topLeft.x,
          y: nodeData.viewportCoordinates.topLeft.y,
        },
        topRight: {
          x: nodeData.viewportCoordinates.topRight.x,
          y: nodeData.viewportCoordinates.topRight.y,
        },
        bottomLeft: {
          x: nodeData.viewportCoordinates.bottomLeft.x,
          y: nodeData.viewportCoordinates.bottomLeft.y,
        },
        bottomRight: {
          x: nodeData.viewportCoordinates.bottomRight.x,
          y: nodeData.viewportCoordinates.bottomRight.y,
        },
        center: {
          x: nodeData.viewportCoordinates.center.x,
          y: nodeData.viewportCoordinates.center.y,
        },
        width: nodeData.viewportCoordinates.width,
        height: nodeData.viewportCoordinates.height,
      };
    }

    if (nodeData.pageCoordinates) {
      pageCoordinates = {
        topLeft: {
          x: nodeData.pageCoordinates.topLeft.x,
          y: nodeData.pageCoordinates.topLeft.y,
        },
        topRight: {
          x: nodeData.pageCoordinates.topRight.x,
          y: nodeData.pageCoordinates.topRight.y,
        },
        bottomLeft: {
          x: nodeData.pageCoordinates.bottomLeft.x,
          y: nodeData.pageCoordinates.bottomLeft.y,
        },
        bottomRight: {
          x: nodeData.pageCoordinates.bottomRight.x,
          y: nodeData.pageCoordinates.bottomRight.y,
        },
        center: {
          x: nodeData.pageCoordinates.center.x,
          y: nodeData.pageCoordinates.center.y,
        },
        width: nodeData.pageCoordinates.width,
        height: nodeData.pageCoordinates.height,
      };
    }

    const elementNode: DOMElementNode = {
      type: "ELEMENT_NODE",
      tagName: nodeData.tagName || "",
      xpath: nodeData.xpath || "",
      attributes: nodeData.attributes || {},
      children: [],
      isVisible: nodeData.isVisible || false,
      isInteractive: nodeData.isInteractive || false,
      isTopElement: nodeData.isTopElement || false,
      isInViewport: nodeData.isInViewport || false,
      highlightIndex: nodeData.highlightIndex,
      shadowRoot: nodeData.shadowRoot || false,
      parent: null,
      viewportInfo: viewportInfo,
      viewportCoordinates: viewportCoordinates,
      pageCoordinates: pageCoordinates,
    };

    const childrenIds = nodeData.children || [];

    return { node: elementNode, childrenIds };
  }

  /**
   * Calculates the hierarchical path from root to element as tag names (internal use).
   * This method traverses up the DOM tree from an element to the root and collects
   * the tag names to create a unique branch path identifier.
   *
   * @param element - DOMElementNode to calculate path for
   * @returns Array of tag names representing the path from root to element
   */
  private _getParentBranchPath(element: DOMElementNode): string[] {
    const parents: DOMElementNode[] = [];
    let current = element;

    while (current.parent !== null) {
      parents.push(current);
      current = current.parent;
    }

    parents.reverse();
    return parents.map((parent) => parent.tagName);
  }

  /**
   * Hashes a string using SHA256 (internal use).
   * This method provides a consistent hashing mechanism for creating element fingerprints.
   *
   * @param input - String to hash
   * @returns SHA256 hash digest as hexadecimal string
   */
  private _hashString(input: string): string {
    return createHash("sha256").update(input).digest("hex");
  }

  /**
   * Log performance metrics from DOM analysis
   *
   * @param url - The URL of the page being analyzed
   * @param evalPage - JSEvalResult containing performance metrics data
   */
  private logPerformanceMetrics(url: string, evalPage: JSEvalResult): void {
    const perf = evalPage.perfMetrics;
    if (!perf || !perf.nodeMetrics) {
      return;
    }

    const totalNodes = perf.nodeMetrics.totalNodes || 0;

    // Count interactive elements
    let interactiveCount = 0;
    for (const nodeData of Object.values(evalPage.map)) {
      if ((nodeData as JSNodeData).isInteractive) {
        interactiveCount++;
      }
    }

    const urlShort = url.length > 50 ? url.substring(0, 50) + "..." : url;
    this.logger.debug(
      `🔎 Ran buildDOMTree.js interactive element detection on: ${urlShort} interactive=${interactiveCount}/${totalNodes}`
    );
  }

  // ==================== Text Processing Methods ====================

  /**
   * Cap text length with ellipsis
   *
   * @param text - The text to potentially truncate
   * @param maxLength - Maximum length before truncation
   * @returns string that is at most maxLength characters with ellipsis if truncated
   */
  private capTextLength(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
      return text;
    }
    return text.substring(0, maxLength - 3) + "...";
  }

  /**
   * Check if a node has a parent with highlight index
   *
   * @param node - DOMNode to check for highlighted parent
   * @returns boolean indicating whether node has a highlighted parent
   */
  private hasParentWithHighlightIndex(node: DOMNode): boolean {
    let current = node.parent;
    while (current !== null) {
      // Stop if the element has a highlight index (will be handled separately)
      if (
        current.highlightIndex !== null &&
        current.highlightIndex !== undefined
      ) {
        return true;
      }
      current = current.parent;
    }
    return false;
  }

  /**
   * Get all text from a node until the next clickable element
   *
   * @param node - DOMElementNode to extract text from
   * @param maxDepth - Maximum depth to traverse (default: -1, no limit)
   * @returns string containing extracted text
   */
  private getAllTextTillNextClickableElement(
    node: DOMElementNode,
    maxDepth: number = -1
  ): string {
    const textParts: string[] = [];

    const collectText = (currentNode: DOMNode, currentDepth: number): void => {
      if (maxDepth !== -1 && currentDepth > maxDepth) {
        return;
      }

      // Skip this branch if we hit a highlighted element (except for the current node)
      if (
        currentNode.type === "ELEMENT_NODE" &&
        currentNode !== node &&
        currentNode.highlightIndex !== null &&
        currentNode.highlightIndex !== undefined
      ) {
        return;
      }

      if (currentNode.type === "TEXT_NODE") {
        textParts.push(currentNode.text);
      } else if (currentNode.type === "ELEMENT_NODE") {
        for (const child of currentNode.children) {
          collectText(child, currentDepth + 1);
        }
      }
    };

    collectText(node, 0);
    return textParts.join("\n").trim();
  }
}
