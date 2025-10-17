/**
 * DOM Service - Simplified implementation using Electron's debugger directly
 *
 * Simplified implementation following browser-use patterns with direct CDP integration
 * and minimal abstraction layers.
 */

import type { WebContents } from "electron";
import log from "electron-log/main";

import type {
  IDOMService,
  EnhancedDOMTreeNode,
  TargetAllTrees,
  CurrentPageTargets,
  ViewportInfo,
  DOMSnapshot,
  SerializedDOMState,
  SerializationConfig,
  SerializationTiming,
  SerializationStats,
} from "@shared/dom";
import { DOMTreeBuilder } from "./builders/DOMTreeBuilder";
import { DOMTreeSerializer } from "./serializer/DOMTreeSerializer";

export class DOMService implements IDOMService {
  private webContents: WebContents;
  private isInitialized = false;
  private logger = log.scope("DOMService");
  private serializer: DOMTreeSerializer;
  private previousState?: SerializedDOMState;

  constructor(webContents: WebContents) {
    this.webContents = webContents;
    this.isInitialized = true;
    this.serializer = new DOMTreeSerializer();
    this.logger.info(
      "DOMService initialized (Simplified - direct CDP integration with serialization pipeline)"
    );
  }

  /**
   * Get the underlying debugger (for advanced usage)
   */
  getDebugger() {
    return this.webContents.debugger;
  }

  /**
   * Get the webContents instance
   */
  getWebContents(): WebContents {
    return this.webContents;
  }

  /**
   * Send CDP command with simple wrapper
   */
  async sendCommand<T = unknown>(method: string, params?: unknown): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.webContents.debugger.removeAllListeners("message");
        reject(new Error(`Command ${method} timed out after 10 seconds`));
      }, 10000);

      try {
        this.webContents.debugger.sendCommand(method, params);
        this.logger.debug(`Command sent: ${method}`);

        const handleResponse = (
          _event: unknown,
          responseMethod: string,
          responseParams: unknown
        ) => {
          if (responseMethod === method || responseMethod.includes("error")) {
            this.webContents.debugger.removeAllListeners("message");
            clearTimeout(timeout);

            if (responseMethod.includes("error")) {
              reject(new Error(`Command ${method} failed`));
            } else {
              this.logger.debug(`Command succeeded: ${method}`);
              resolve(responseParams as T);
            }
          }
        };

        this.webContents.debugger.on("message", handleResponse);
      } catch (error) {
        clearTimeout(timeout);
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        this.logger.error(`Failed to send command ${method}: ${errorMessage}`);
        reject(new Error(`Command send failed: ${errorMessage}`));
      }
    });
  }

  /**
   * Attach the debugger to the webContents
   */
  async attach(protocolVersion = "1.3"): Promise<void> {
    try {
      this.logger.debug(
        `Attaching debugger with protocol version: ${protocolVersion}`
      );
      this.webContents.debugger.attach(protocolVersion);
      this.logger.info("Debugger attached successfully");
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`Failed to attach debugger: ${errorMessage}`);
      throw new Error(`Debugger attach failed: ${errorMessage}`);
    }
  }

  /**
   * Detach the debugger from the webContents
   */
  async detach(): Promise<void> {
    try {
      this.logger.debug("Detaching debugger");
      this.webContents.debugger.detach();
      this.logger.info("Debugger detached successfully");
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`Failed to detach debugger: ${errorMessage}`);
      throw new Error(`Debugger detach failed: ${errorMessage}`);
    }
  }

  /**
   * Check if debugger is attached
   */
  isAttached(): boolean {
    return this.webContents.debugger.isAttached();
  }

  /**
   * Get enhanced DOM tree with integrated CDP data
   */
  async getDOMTree(targetId?: string): Promise<EnhancedDOMTreeNode> {
    if (!this.isInitialized) {
      throw new Error("DOMService not initialized");
    }

    if (!this.isAttached()) {
      throw new Error("Debugger not attached - call initialize() first");
    }

    try {
      this.logger.debug(
        `Getting DOM tree for target: ${targetId || "default"}`
      );

      // Get all required data from CDP
      const trees = await this.getAllTrees(targetId);
      const targets = await this.getTargetsForPage(targetId);

      // Build enhanced DOM tree
      const enhancedTree = DOMTreeBuilder.buildEnhancedDOMTree(trees, targets);

      // Calculate visibility for all nodes
      DOMTreeBuilder.calculateVisibility(enhancedTree);

      this.logger.info(
        `DOM tree built successfully with ${this.countNodes(
          enhancedTree
        )} nodes`
      );
      return enhancedTree;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`Failed to get DOM tree: ${errorMessage}`);
      throw new Error(`DOM tree analysis failed: ${errorMessage}`);
    }
  }

  /**
   * Get device pixel ratio from layout metrics
   * Enhanced implementation following browser-use reference patterns
   */
  async getDevicePixelRatio(): Promise<number> {
    if (!this.isInitialized) {
      throw new Error("DOMService not initialized");
    }

    if (!this.isAttached()) {
      throw new Error("Debugger not attached - call initialize() first");
    }

    try {
      this.logger.debug("Getting device pixel ratio with enhanced metrics");

      const layoutMetrics = (await this.sendCommand(
        "Page.getLayoutMetrics"
      )) as {
        visualViewport?: Record<string, number>;
        cssVisualViewport?: Record<string, number>;
        layoutViewport?: Record<string, number>;
        contentSize?: Record<string, number>;
      };

      // Extract device pixel ratio from multiple sources for accuracy
      const visualViewport = layoutMetrics.visualViewport || {};
      const cssVisualViewport = layoutMetrics.cssVisualViewport || {};
      const layoutViewport = layoutMetrics.layoutViewport || {};

      // Primary method: Use CSS visual viewport device pixel ratio if available
      if (cssVisualViewport.devicePixelRatio !== undefined) {
        const dpr = cssVisualViewport.devicePixelRatio;
        this.logger.debug(`Device pixel ratio from CSS viewport: ${dpr}`);
        return Math.max(1.0, dpr); // Ensure minimum DPR of 1.0
      }

      // Secondary method: Calculate from visual vs CSS viewport dimensions
      const deviceWidth = visualViewport.clientWidth || cssVisualViewport.clientWidth || layoutViewport.clientWidth || 1920;
      const cssWidth = cssVisualViewport.clientWidth || visualViewport.clientWidth || layoutViewport.clientWidth || 1920;
      const deviceHeight = visualViewport.clientHeight || cssVisualViewport.clientHeight || layoutViewport.clientHeight || 1080;
      const cssHeight = cssVisualViewport.clientHeight || visualViewport.clientHeight || layoutViewport.clientHeight || 1080;

      // Calculate device pixel ratio using both width and height for accuracy
      const dprWidth = deviceWidth / cssWidth;
      const dprHeight = deviceHeight / cssHeight;
      const calculatedDpr = (dprWidth + dprHeight) / 2; // Average of both calculations

      const finalDpr = Math.max(1.0, Math.min(calculatedDpr, 4.0)); // Clamp between 1.0 and 4.0

      this.logger.debug(
        `Device pixel ratio calculated: ${finalDpr} (width: ${dprWidth}, height: ${dprHeight})`
      );

      return finalDpr;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      this.logger.warn(
        `Failed to get device pixel ratio (${errorMessage}), using fallback: 1.0`
      );
      return 1.0;
    }
  }

  /**
   * Get all CDP tree data for DOM analysis
   */
  private async getAllTrees(_targetId?: string): Promise<TargetAllTrees> {
    const startTime = Date.now();

    try {
      this.logger.debug("Collecting all CDP tree data");

      // Get device pixel ratio first
      const devicePixelRatio = await this.getDevicePixelRatio();

      // Get DOM document
      const domTree = await this.sendCommand("DOM.getDocument", {
        depth: -1,
        pierce: true,
      });

      // Get DOM snapshot
      const snapshot = await this.getDOMSnapshot();

      // Get accessibility tree
      const axTree = await this.getAccessibilityTree();

      const endTime = Date.now();
      const cdpTiming = {
        cdp_calls_total: (endTime - startTime) / 1000,
      };

      this.logger.debug(
        `CDP tree collection completed in ${cdpTiming.cdp_calls_total}s`
      );

      return {
        snapshot,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        domTree: domTree as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        axTree: axTree as { nodes: any[] },
        devicePixelRatio,
        cdpTiming,
      };
    } catch (_error) {
      const errorMessage = "CDP data collection failed";
      this.logger.error(`Failed to collect CDP tree data: ${errorMessage}`);
      throw new Error(errorMessage);
    }
  }

  /**
   * Get DOM snapshot with enhanced computed styles
   * Matches browser-use reference with comprehensive style collection
   */
  private async getDOMSnapshot(): Promise<DOMSnapshot> {
    try {
      // Enhanced computed styles following browser-use reference
      // Only include styles that are actually used in the analysis to prevent Chrome crashes
      const computedStyles = [
        // Core visibility styles
        "display",
        "visibility",
        "opacity",
        "background-color",
        "color",

        // Layout and positioning
        "position",
        "overflow",
        "overflow-x",
        "overflow-y",

        // Interaction styles
        "cursor",
        "pointer-events",

        // Additional important styles for interactivity detection
        "z-index",
        "transform",
        "box-shadow",
        "text-shadow",

        // Form-related styles
        "background",
        "border",
        "border-radius",
        "outline"
      ];

      this.logger.debug(`Capturing DOM snapshot with ${computedStyles.length} computed styles`);

      const snapshot = await this.sendCommand("DOMSnapshot.captureSnapshot", {
        computedStyles,
        includePaintOrder: true,
        includeDOMRects: true,
        includeBlendedBackgroundColors: false,
        includeTextColorOpacities: false,
      });

      const snapshotResult = snapshot as DOMSnapshot;

      this.logger.debug(
        `DOM snapshot captured: ${snapshotResult.documents?.length || 0} documents, ` +
        `${snapshotResult.strings?.length || 0} strings`
      );

      return snapshotResult;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      this.logger.warn(
        `DOM snapshot capture failed: ${errorMessage}. Some features may be limited`
      );

      // Return empty snapshot as fallback
      return { documents: [], strings: [] };
    }
  }

  /**
   * Get accessibility tree
   */
  private async getAccessibilityTree(
    _frameId?: string
  ): Promise<{ nodes: unknown[] }> {
    try {
      const axTree = await this.sendCommand("Accessibility.getFullAXTree");
      return { nodes: (axTree as { nodes?: unknown[] }).nodes || [] };
    } catch (_error) {
      this.logger.warn(
        "Accessibility tree capture failed, accessibility features may be limited"
      );
      return { nodes: [] };
    }
  }

  /**
   * Get viewport information
   */
  async getViewportInfo(): Promise<ViewportInfo> {
    if (!this.isInitialized) {
      throw new Error("DOMService not initialized");
    }

    try {
      const layoutMetrics = await this.sendCommand("Page.getLayoutMetrics");
      const visualViewport =
        (layoutMetrics as { visualViewport?: Record<string, number> })
          .visualViewport || {};
      const cssVisualViewport =
        (layoutMetrics as { cssVisualViewport?: Record<string, number> })
          .cssVisualViewport || {};

      return {
        width:
          cssVisualViewport.clientWidth || visualViewport.clientWidth || 1920,
        height:
          cssVisualViewport.clientHeight || visualViewport.clientHeight || 1080,
        devicePixelRatio: await this.getDevicePixelRatio(),
        scrollX: visualViewport.pageXOffset || 0,
        scrollY: visualViewport.pageYOffset || 0,
      };
    } catch (_error) {
      this.logger.warn("Failed to get viewport info, using defaults");
      return {
        width: 1920,
        height: 1080,
        devicePixelRatio: 1.0,
        scrollX: 0,
        scrollY: 0,
      };
    }
  }

  /**
   * Get frame tree
   */
  async getFrameTree(): Promise<{
    frameTree: {
      frame: {
        id: string;
        url: string;
        name?: string;
        securityOrigin?: string;
      };
      childFrames?: unknown[];
      parent?: unknown;
    };
  }> {
    if (!this.isInitialized) {
      throw new Error("DOMService not initialized");
    }

    try {
      const frameTree = await this.sendCommand("Page.getFrameTree");
      return frameTree as {
        frameTree: {
          frame: {
            id: string;
            url: string;
            name?: string;
            securityOrigin?: string;
          };
          childFrames?: unknown[];
          parent?: unknown;
        };
      };
    } catch (_error) {
      const errorMessage = "Frame tree detection failed";
      this.logger.error(`Failed to get frame tree: ${errorMessage}`);
      throw new Error(errorMessage);
    }
  }

  /**
   * Get targets for current page
   */
  async getTargetsForPage(targetId?: string): Promise<CurrentPageTargets> {
    try {
      this.logger.debug(`Getting targets for page: ${targetId || "default"}`);

      // Get all targets
      const targetsData = (await this.sendCommand("Target.getTargets")) as {
        targetInfos: Array<{
          targetId: string;
          type: string;
          title: string;
          url: string;
          attached: boolean;
        }>;
      };

      // Find main page target
      const mainTargetId = targetId || "default";
      const mainTarget = targetsData.targetInfos.find(
        (target) => target.targetId === mainTargetId
      );

      if (!mainTarget) {
        throw new Error(`Main target not found: ${mainTargetId}`);
      }

      // For now, return simple structure without iframe sessions
      // This can be enhanced later when cross-origin iframe support is needed
      return {
        pageSession: mainTarget,
        iframeSessions: [], // Simplified - no iframe handling in phase 1-2
      };
    } catch (_error) {
      const errorMessage = "Target detection failed";
      this.logger.error(`Failed to get targets for page: ${errorMessage}`);
      throw new Error(errorMessage);
    }
  }

  /**
   * Count total nodes in enhanced DOM tree (for debugging)
   */
  private countNodes(node: EnhancedDOMTreeNode): number {
    let count = 1;

    if (node.childrenNodes) {
      for (const child of node.childrenNodes) {
        count += this.countNodes(child);
      }
    }

    if (node.shadowRoots) {
      for (const shadowRoot of node.shadowRoots) {
        count += this.countNodes(shadowRoot);
      }
    }

    if (node.contentDocument) {
      count += this.countNodes(node.contentDocument);
    }

    return count;
  }

  /**
   * Initialize the DOM service
   */
  async initialize(): Promise<void> {
    if (!this.isInitialized) {
      throw new Error("DOMService not properly initialized");
    }

    try {
      // Attach the debugger
      await this.attach();
      this.logger.info("DOMService initialized and debugger attached");
    } catch (error) {
      this.logger.error("Failed to initialize DOMService:", error);
      throw error;
    }
  }

  /**
   * Cleanup resources
   */
  async destroy(): Promise<void> {
    this.logger.debug("Destroying DOMService");

    try {
      // Cleanup debugger
      await this.detach();

      // Clear previous state
      this.previousState = undefined;

      this.isInitialized = false;
      this.logger.info("DOMService destroyed");
    } catch (error) {
      this.logger.error("Error during DOMService destruction:", error);
    }
  }

  /**
   * Check if the service is initialized
   */
  isReady(): boolean {
    return this.isInitialized && this.isAttached();
  }

  /**
   * Get serialized DOM tree optimized for LLM consumption
   */
  async getSerializedDOMTree(
    previousState?: SerializedDOMState,
    config?: Partial<SerializationConfig>
  ): Promise<{
    serializedState: SerializedDOMState;
    timing: SerializationTiming;
    stats: SerializationStats;
  }> {
    if (!this.isInitialized) {
      throw new Error("DOMService not initialized");
    }

    if (!this.isAttached()) {
      throw new Error("Debugger not attached - call initialize() first");
    }

    try {
      this.logger.debug("Getting serialized DOM tree for LLM consumption");

      // Get enhanced DOM tree
      const domTree = await this.getDOMTree();

      // Serialize with previous state for change detection
      const result = await this.serializer.serializeDOMTree(
        domTree,
        previousState,
        config
      );

      // Store previous state for change detection
      this.previousState = result.serializedState;

      this.logger.info(
        `DOM tree serialized successfully: ${result.stats.interactiveElements} interactive elements, ${result.stats.filteredNodes} filtered nodes`
      );

      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`Failed to serialize DOM tree: ${errorMessage}`);
      throw new Error(`DOM serialization failed: ${errorMessage}`);
    }
  }

  /**
   * Get DOM tree with change detection for efficient updates
   */
  async getDOMTreeWithChangeDetection(
    previousState?: SerializedDOMState
  ): Promise<{
    domTree: EnhancedDOMTreeNode;
    serializedState?: SerializedDOMState;
    hasChanges: boolean;
    changeCount: number;
  }> {
    if (!this.isInitialized) {
      throw new Error("DOMService not initialized");
    }

    if (!this.isAttached()) {
      throw new Error("Debugger not attached - call initialize() first");
    }

    try {
      this.logger.debug("Getting DOM tree with change detection");

      // Get enhanced DOM tree
      const domTree = await this.getDOMTree();

      // If no previous state, everything is new
      if (!previousState) {
        const serializedResult = await this.serializer.serializeDOMTree(domTree);
        return {
          domTree,
          serializedState: serializedResult.serializedState,
          hasChanges: true,
          changeCount: serializedResult.stats.totalNodes
        };
      }

      // Compare with previous state
      const serializedResult = await this.serializer.serializeDOMTree(
        domTree,
        previousState
      );

      const changeCount = serializedResult.stats.newElements;
      const hasChanges = changeCount > 0;

      this.logger.debug(
        `Change detection completed: ${changeCount} changes detected`
      );

      return {
        domTree,
        serializedState: serializedResult.serializedState,
        hasChanges,
        changeCount
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`Failed to get DOM tree with change detection: ${errorMessage}`);
      throw new Error(`Change detection failed: ${errorMessage}`);
    }
  }

  /**
   * Get service status information
   */
  getStatus(): {
    isInitialized: boolean;
    isAttached: boolean;
    webContentsId: number;
    hasPreviousState: boolean;
    serializationEnabled: boolean;
  } {
    return {
      isInitialized: this.isInitialized,
      isAttached: this.isAttached(),
      webContentsId: this.webContents.id,
      hasPreviousState: !!this.previousState,
      serializationEnabled: !!this.serializer
    };
  }
}
