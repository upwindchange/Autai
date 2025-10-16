/**
 * DOM service interfaces for CDP infrastructure
 * Simplified implementation following browser-use patterns with minimal abstraction
 */

import type { Debugger, WebContents } from "electron";
import type { CurrentPageTargets, EnhancedDOMTreeNode, ViewportInfo } from "./types";

export interface IDOMService {
  /**
   * Get the webContents instance
   */
  getWebContents(): WebContents;

  /**
   * Send a CDP command
   */
  sendCommand<T = unknown>(
    method: string,
    params?: unknown
  ): Promise<T>;

  /**
   * Get the underlying debugger (for advanced usage)
   */
  getDebugger(): Debugger;

  /**
   * Attach the debugger to the webContents
   */
  attach(protocolVersion?: string): Promise<void>;

  /**
   * Detach the debugger from the webContents
   */
  detach(): Promise<void>;

  /**
   * Check if debugger is attached
   */
  isAttached(): boolean;

  /**
   * Get enhanced DOM tree with integrated CDP data
   */
  getDOMTree(targetId?: string): Promise<EnhancedDOMTreeNode>;

  /**
   * Initialize the DOM service
   */
  initialize(): Promise<void>;

  /**
   * Check if the service is ready
   */
  isReady(): boolean;

  /**
   * Get service status information
   */
  getStatus(): {
    isInitialized: boolean;
    isAttached: boolean;
    webContentsId: number;
  };

  /**
   * Get viewport information
   */
  getViewportInfo(): Promise<ViewportInfo>;

  /**
   * Get frame tree
   */
  getFrameTree(): Promise<{
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
  }>;

  /**
   * Get targets for current page
   */
  getTargetsForPage(targetId?: string): Promise<CurrentPageTargets>;

  /**
   * Cleanup resources
   */
  destroy(): Promise<void>;
}
