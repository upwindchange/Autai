import { WebContentsView, BrowserWindow } from "electron";
import type { StateManager } from ".";
import type { View, ActionResult, IViewManager } from "../../shared/types";
import {
  getHintDetectorScript,
  getIndexScript,
} from "../scripts/hintDetectorLoader";

/**
 * Single source of truth for all WebContentsView operations
 * Consolidates view resolution, lifecycle management, and access patterns
 */
export class WebViewService implements IViewManager {
  private stateManager: StateManager;
  private win: BrowserWindow;
  private webContentsViews = new Map<string, WebContentsView>();
  private eventListeners = new Map<string, (() => void)[]>();

  constructor(stateManager: StateManager, win: BrowserWindow) {
    this.stateManager = stateManager;
    this.win = win;
  }

  // ===================
  // VIEW RESOLUTION API
  // ===================

  /**
   * Gets a WebContentsView by task and page ID
   */
  getWebContentsView(taskId: string, pageId: string): WebContentsView | null {
    const view = this.stateManager.getViewForPage(taskId, pageId);
    if (!view) return null;

    return this.webContentsViews.get(view.id) || null;
  }

  /**
   * Gets a WebContentsView by task and page ID, throwing if not found
   */
  requireWebContentsView(taskId: string, pageId: string): WebContentsView {
    const view = this.stateManager.getViewForPage(taskId, pageId);
    if (!view) {
      throw new Error(`No view found for task ${taskId}, page ${pageId}`);
    }

    const webView = this.webContentsViews.get(view.id);
    if (!webView) {
      throw new Error(`WebContentsView not found for view ${view.id}`);
    }

    return webView;
  }

  /**
   * Gets a WebContentsView by view ID
   */
  getWebContentsViewById(viewId: string): WebContentsView | null {
    return this.webContentsViews.get(viewId) || null;
  }

  /**
   * Gets a WebContentsView by view ID, throwing if not found
   */
  requireWebContentsViewById(viewId: string): WebContentsView {
    const webView = this.webContentsViews.get(viewId);
    if (!webView) {
      throw new Error(`WebContentsView not found for view ${viewId}`);
    }
    return webView;
  }

  // ===================
  // LIFECYCLE MANAGEMENT
  // ===================

  /**
   * Creates a new WebContentsView for a page
   */
  async createView(
    taskId: string,
    pageId: string,
    url: string
  ): Promise<View | null> {
    const task = this.stateManager.getTask(taskId);
    const page = task?.pages.get(pageId);
    if (!task || !page) return null;

    // Check if view already exists
    const existingView = this.stateManager.getViewForPage(taskId, pageId);
    if (existingView) return existingView;

    const viewId = `view-${Date.now()}-${Math.random()
      .toString(36)
      .substring(2, 11)}`;

    // Create WebContentsView
    const webView = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    webView.setBackgroundColor("#00000000");

    // Set up event handlers
    const listeners = this.setupEventHandlers(webView, viewId, taskId, pageId);
    this.eventListeners.set(viewId, listeners);

    // Load URL
    try {
      await webView.webContents.loadURL(url);
    } catch (error) {
      console.error(`Failed to load URL ${url}:`, error);
    }

    // Create view metadata
    const view: View = {
      id: viewId,
      taskId,
      pageId,
    };

    // Store WebContentsView and register with StateManager
    this.webContentsViews.set(viewId, webView);
    this.stateManager.registerView(viewId, view);
    this.win.contentView.addChildView(webView);
    
    // Set default bounds (1080p) and hide initially
    webView.setBounds({ x: 0, y: 0, width: 1920, height: 1080 });
    webView.setVisible(false); // Initially hidden

    return view;
  }

  /**
   * Destroys a WebContentsView and cleans up resources
   */
  destroyView(viewId: string): void {
    const view = this.stateManager.getView(viewId);
    const webView = this.webContentsViews.get(viewId);

    if (!view || !webView) return;

    try {
      // Clean up event listeners
      const listeners = this.eventListeners.get(viewId);
      if (listeners) {
        listeners.forEach((removeListener) => {
          try {
            removeListener();
          } catch (_err) {
            // Ignore cleanup errors
          }
        });
        this.eventListeners.delete(viewId);
      }

      // Clean up WebContents
      if (webView.webContents && !webView.webContents.isDestroyed()) {
        try {
          webView.webContents.stop();
          webView.webContents.removeAllListeners();
          webView.webContents.close({ waitForBeforeUnload: false });
          webView.webContents.forcefullyCrashRenderer();
        } catch (_error) {
          // Ignore cleanup errors
        }
      }

      // Remove from window
      if (this.win && !this.win.isDestroyed() && this.win.contentView) {
        try {
          this.win.contentView.removeChildView(webView);
        } catch (error) {
          console.error(`Error removing view from window:`, error);
        }
      }
    } catch (error) {
      console.error(`Error destroying view ${viewId}:`, error);
    }

    // Clean up our storage and notify StateManager
    this.webContentsViews.delete(viewId);
    this.stateManager.unregisterView(viewId);
  }

  // ===================
  // VIEW OPERATIONS
  // ===================

  /**
   * Sets view bounds
   */
  setViewBounds(viewId: string, bounds: Electron.Rectangle): void {
    const webView = this.webContentsViews.get(viewId);
    if (!webView) return;

    // Only update actual bounds if this is the active view and it's visible
    if (this.stateManager.isActiveView(viewId) && webView.getVisible()) {
      webView.setBounds(bounds);
    }
  }

  /**
   * Sets view visibility
   */
  setViewVisibility(viewId: string, isVisible: boolean): void {
    const webView = this.webContentsViews.get(viewId);
    if (!webView) return;

    // Apply visibility if this is the active view
    if (this.stateManager.isActiveView(viewId)) {
      webView.setVisible(isVisible);
    }
  }

  /**
   * Updates visibility of all views - shows only the active view
   */
  updateViewVisibility(): void {
    const activeViewId = this.stateManager.getActiveViewId();

    this.webContentsViews.forEach((webView, viewId) => {
      if (viewId === activeViewId) {
        webView.setVisible(true);
      } else {
        webView.setVisible(false);
      }
    });
  }

  // ===================
  // SCRIPT EXECUTION
  // ===================

  /**
   * Execute JavaScript in a WebContentsView with consistent error handling
   */
  async executeScript(
    taskId: string,
    pageId: string,
    script: string
  ): Promise<ActionResult> {
    try {
      const webView = this.requireWebContentsView(taskId, pageId);
      const result = await webView.webContents.executeJavaScript(script);
      return { success: true, data: result };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to execute script",
      };
    }
  }

  /**
   * Execute a window function with arguments
   */
  async executeWindowFunction(
    taskId: string,
    pageId: string,
    functionName: string,
    ...args: unknown[]
  ): Promise<ActionResult> {
    const script = `window.${functionName} && window.${functionName}(${args
      .map((arg) => JSON.stringify(arg))
      .join(", ")})`;
    return this.executeScript(taskId, pageId, script);
  }

  // ===================
  // PRIVATE METHODS
  // ===================

  /**
   * Sets up event handlers for a WebContentsView
   */
  private setupEventHandlers(
    webView: WebContentsView,
    viewId: string,
    taskId: string,
    pageId: string
  ): (() => void)[] {
    const listeners: (() => void)[] = [];

    // Page title updates
    const titleHandler = (_event: unknown, title: string) => {
      this.stateManager.updatePage(taskId, pageId, { title });
    };
    webView.webContents.on("page-title-updated", titleHandler);
    listeners.push(() =>
      webView.webContents.off("page-title-updated", titleHandler)
    );

    // Favicon updates
    const faviconHandler = (_event: unknown, favicons: string[]) => {
      if (favicons.length > 0) {
        this.stateManager.updatePage(taskId, pageId, { favicon: favicons[0] });
      }
    };
    webView.webContents.on("page-favicon-updated", faviconHandler);
    listeners.push(() =>
      webView.webContents.off("page-favicon-updated", faviconHandler)
    );

    // Page load completion - inject scripts
    const loadHandler = async () => {
      try {
        // Inject hint detector script
        const hintDetectorScript = getHintDetectorScript();
        await webView.webContents.executeJavaScript(hintDetectorScript);

        // Inject index.js script wrapped in IIFE to define buildDomTree globally
        const indexScript = getIndexScript();
        const wrappedIndexScript = `
          (function() {
            window.buildDomTree = ${indexScript};
          })();
        `;
        await webView.webContents.executeJavaScript(wrappedIndexScript);

        console.log(`Successfully injected scripts for view ${viewId}`);
      } catch (error) {
        console.error("Failed to inject scripts:", error);
      }
    };
    webView.webContents.on("did-finish-load", loadHandler);
    listeners.push(() =>
      webView.webContents.off("did-finish-load", loadHandler)
    );

    // Console message forwarding
    const consoleHandler = ({
      level,
      message,
      sourceId,
    }: {
      level: string;
      message: string;
      sourceId: string;
    }) => {
      if (
        message.includes("[HintDetector]") ||
        sourceId.includes("hintDetector")
      ) {
        const logPrefix = `[WebView ${viewId}]`;
        switch (level) {
          case "info":
            console.log(`${logPrefix} ${message}`);
            break;
          case "warning":
            console.warn(`${logPrefix} ${message}`);
            break;
          case "error":
            console.error(`${logPrefix} ${message}`);
            break;
          case "debug":
            console.log(`${logPrefix} ${message}`);
            break;
          default:
            console.log(`${logPrefix} ${message}`);
        }
      }
    };
    webView.webContents.on("console-message", consoleHandler);
    listeners.push(() =>
      webView.webContents.off("console-message", consoleHandler)
    );

    // WebContents destroyed handler
    const destroyedHandler = () => {
      console.log(`WebContents for view ${viewId} was destroyed`);
      if (this.stateManager.getView(viewId)) {
        this.destroyView(viewId);
      }
    };
    webView.webContents.on("destroyed", destroyedHandler);
    listeners.push(() => {
      if (!webView.webContents.isDestroyed()) {
        webView.webContents.off("destroyed", destroyedHandler);
      }
    });

    // Navigation error handler
    const failLoadHandler = (
      _event: unknown,
      errorCode: number,
      errorDescription: string,
      validatedURL: string
    ) => {
      console.error(
        `Failed to load ${validatedURL} in view ${viewId}: ${errorDescription} (${errorCode})`
      );
    };
    webView.webContents.on("did-fail-load", failLoadHandler);
    listeners.push(() =>
      webView.webContents.off("did-fail-load", failLoadHandler)
    );

    // Crash handler
    const crashHandler = (_event: unknown, details: unknown) => {
      console.error(`Renderer process crashed for view ${viewId}:`, details);
      this.stateManager.emitStateChange({
        type: "VIEW_CRASHED",
        viewId,
        details,
      });
    };
    webView.webContents.on("render-process-gone", crashHandler);
    listeners.push(() =>
      webView.webContents.off("render-process-gone", crashHandler)
    );

    return listeners;
  }

  /**
   * Cleanup all resources
   */
  destroy(): void {
    // Destroy all views
    Array.from(this.webContentsViews.keys()).forEach((viewId) =>
      this.destroyView(viewId)
    );

    this.webContentsViews.clear();
    this.eventListeners.clear();
  }
}
