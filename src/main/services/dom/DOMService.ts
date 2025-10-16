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
} from "@shared/dom";
import { DOMTreeBuilder } from "./builders/DOMTreeBuilder";

export class DOMService implements IDOMService {
  private webContents: WebContents;
  private isInitialized = false;
  private logger = log.scope("DOMService");

  constructor(webContents: WebContents) {
    this.webContents = webContents;
    this.isInitialized = true;
    this.logger.info(
      "DOMService initialized (Simplified - direct CDP integration)"
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
   */
  async getDevicePixelRatio(): Promise<number> {
    if (!this.isInitialized) {
      throw new Error("DOMService not initialized");
    }

    if (!this.isAttached()) {
      throw new Error("Debugger not attached - call initialize() first");
    }

    try {
      this.logger.debug("Getting device pixel ratio");

      const layoutMetrics = (await this.sendCommand(
        "Page.getLayoutMetrics"
      )) as {
        visualViewport?: Record<string, number>;
        cssVisualViewport?: Record<string, number>;
      };

      // Extract device pixel ratio from visual viewport
      const visualViewport = layoutMetrics.visualViewport || {};
      const cssVisualViewport = layoutMetrics.cssVisualViewport || {};

      // Calculate device pixel ratio
      const deviceWidth =
        visualViewport.clientWidth || cssVisualViewport.clientWidth || 1920;
      const cssWidth =
        cssVisualViewport.clientWidth || visualViewport.clientWidth || 1920;
      const devicePixelRatio = deviceWidth / cssWidth;

      this.logger.debug(`Device pixel ratio: ${devicePixelRatio}`);
      return devicePixelRatio || 1.0;
    } catch (_error) {
      this.logger.warn("Failed to get device pixel ratio, using fallback: 1.0");
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
   * Get DOM snapshot with computed styles
   */
  private async getDOMSnapshot(): Promise<DOMSnapshot> {
    try {
      const snapshot = await this.sendCommand("DOMSnapshot.captureSnapshot", {
        computedStyles: [
          "display",
          "visibility",
          "opacity",
          "overflow",
          "overflow-x",
          "overflow-y",
          "cursor",
          "pointer-events",
          "position",
          "background-color",
        ],
        includePaintOrder: true,
        includeDOMRects: true,
        includeBlendedBackgroundColors: false,
        includeTextColorOpacities: false,
      });

      return snapshot as DOMSnapshot;
    } catch (_error) {
      this.logger.warn(
        "DOM snapshot capture failed, some features may be limited"
      );
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
   * Get service status information
   */
  getStatus(): {
    isInitialized: boolean;
    isAttached: boolean;
    webContentsId: number;
  } {
    return {
      isInitialized: this.isInitialized,
      isAttached: this.isAttached(),
      webContentsId: this.webContents.id,
    };
  }
}
