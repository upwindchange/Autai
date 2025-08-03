/**
 * Unified service for all browser view operations with async-first design
 * Consolidates functionality from BrowserViewManager, ViewOrchestrator, and BrowserActionService
 */

import { WebContentsView, BrowserWindow, Rectangle } from "electron";
import { EventEmitter } from "events";
import type {
  IAuiThreadViewManager,
  ThreadId,
  ViewId,
  ViewInfo,
  ViewMetadata,
  ActionResult,
  ThreadEvent,
} from "@shared/index";
import { getIndexScript } from "../scripts/indexLoader";

interface CreateViewConfig {
  viewId: ViewId;
  threadId?: ThreadId;
  url?: string;
  bounds?: Rectangle;
  target?: "tab" | "window";
}

export class BrowserViewService {
  private views = new Map<ViewId, WebContentsView>();
  private viewMetadata = new Map<ViewId, ViewMetadata>();
  private activeView: ViewId | null = null;
  private eventEmitter = new EventEmitter();
  private win: BrowserWindow;
  private threadViewManager!: IAuiThreadViewManager;
  private eventCleanupMap = new Map<ViewId, (() => void)[]>();

  constructor(win: BrowserWindow) {
    this.win = win;
  }

  /**
   * Initialize with thread view manager
   */
  async initialize(threadViewManager: IAuiThreadViewManager): Promise<void> {
    this.threadViewManager = threadViewManager;

    // Subscribe to thread events
    this.threadViewManager.subscribeToThreadEvents(
      async (event: ThreadEvent) => {
        switch (event.type) {
          case "THREAD_SWITCHED":
            await this.switchToThread(event.threadId);
            break;
          case "THREAD_DELETED":
            // Views are cleaned up by thread manager
            break;
        }
      }
    );
  }

  // ===================
  // VIEW LIFECYCLE
  // ===================

  /**
   * Creates a new browser view with optional thread association
   */
  async createView(config: CreateViewConfig): Promise<WebContentsView> {
    const { viewId, url = "about:blank", bounds, threadId } = config;

    // Check if view already exists
    if (this.views.has(viewId)) {
      throw new Error(`View ${viewId} already exists`);
    }

    // Create WebContentsView
    const webView = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    webView.setBackgroundColor("#00000000");

    // Set up event handlers
    const cleanupHandlers = await this.setupEventHandlers(webView, viewId);
    this.eventCleanupMap.set(viewId, cleanupHandlers);

    // Store view and metadata
    this.views.set(viewId, webView);
    this.viewMetadata.set(viewId, {
      id: viewId,
      threadId: threadId || "",
      url,
      title: "",
      favicon: undefined,
      bounds: bounds || { x: 0, y: 0, width: 1920, height: 1080 },
      isVisible: false,
    });

    // Add to window
    this.win.contentView.addChildView(webView);

    // Set bounds and initially hide
    webView.setVisible(false);
    if (bounds) {
      webView.setBounds(bounds);
    } else {
      webView.setBounds({ x: 0, y: 0, width: 1920, height: 1080 });
    }

    // Register with thread manager if threadId provided
    if (threadId && this.threadViewManager) {
      await this.threadViewManager.registerView(threadId, viewId);
    }

    // Load URL
    if (url && url !== "about:blank") {
      await this.navigateView(viewId, url);
    }

    // Emit created event
    const metadata = this.viewMetadata.get(viewId)!;
    const info: ViewInfo = {
      id: metadata.id,
      threadId: metadata.threadId,
      url: metadata.url,
      title: metadata.title,
      favicon: metadata.favicon,
    };
    this.eventEmitter.emit("created", info);

    return webView;
  }

  /**
   * Creates a view for a specific thread
   */
  async createViewForThread(
    threadId: ThreadId,
    target?: "tab" | "window"
  ): Promise<ViewId> {
    // Generate unique view ID
    const viewId = `view-${Date.now()}-${Math.random()
      .toString(36)
      .substring(2, 11)}`;

    // Create the view with thread association
    await this.createView({
      viewId,
      threadId,
      url: "about:blank",
      target,
    });

    // If this thread is active and has no active view, activate this one
    if (
      this.threadViewManager.getActiveThread() === threadId &&
      !this.getActiveViewForThread(threadId)
    ) {
      await this.switchToView(viewId);
    }

    return viewId;
  }

  /**
   * Destroys a view and cleans up all resources
   */
  async destroyView(viewId: ViewId): Promise<void> {
    const webView = this.views.get(viewId);
    if (!webView) return;

    try {
      // Clean up event handlers
      const cleanupHandlers = this.eventCleanupMap.get(viewId);
      if (cleanupHandlers) {
        await Promise.all(
          cleanupHandlers.map(async (cleanup) => {
            try {
              await cleanup();
            } catch (_) {
              // Ignore cleanup errors
            }
          })
        );
        this.eventCleanupMap.delete(viewId);
      }

      // Stop and clean up WebContents
      if (webView.webContents && !webView.webContents.isDestroyed()) {
        try {
          webView.webContents.stop();
          webView.webContents.removeAllListeners();
          webView.webContents.close({ waitForBeforeUnload: false });
          webView.webContents.forcefullyCrashRenderer();
        } catch (_) {
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

    // Unregister from thread manager
    if (this.threadViewManager) {
      await this.threadViewManager.unregisterView(viewId);
    }

    // Clean up storage
    this.views.delete(viewId);
    this.viewMetadata.delete(viewId);

    // Clear active view if needed
    if (this.activeView === viewId) {
      this.activeView = null;
    }

    // Emit destroyed event
    this.eventEmitter.emit("destroyed", viewId);
  }

  /**
   * Closes a view and switches to another in the same thread if available
   */
  async closeView(viewId: ViewId): Promise<void> {
    const threadId = this.threadViewManager?.getThreadForView(viewId);

    // Destroy the view
    await this.destroyView(viewId);

    // If this was the active view, switch to another view in the thread
    if (threadId && this.activeView === viewId) {
      const remainingViews = this.threadViewManager.getViewsForThread(threadId);
      const nextView = Array.from(remainingViews)[0];
      if (nextView) {
        await this.switchToView(nextView);
      }
    }
  }

  // ===================
  // NAVIGATION
  // ===================

  /**
   * Navigates a view to a URL
   */
  async navigateView(viewId: ViewId, url: string): Promise<void> {
    const webView = this.views.get(viewId);
    if (!webView) {
      throw new Error(`View ${viewId} not found`);
    }

    await webView.webContents.loadURL(url);
  }

  /**
   * Goes back in navigation history
   */
  async goBack(viewId: ViewId): Promise<boolean> {
    const webView = this.views.get(viewId);
    if (!webView || !webView.webContents.navigationHistory.canGoBack()) {
      return false;
    }

    webView.webContents.navigationHistory.goBack();
    return true;
  }

  /**
   * Goes forward in navigation history
   */
  async goForward(viewId: ViewId): Promise<boolean> {
    const webView = this.views.get(viewId);
    if (!webView || !webView.webContents.navigationHistory.canGoForward()) {
      return false;
    }

    webView.webContents.navigationHistory.goForward();
    return true;
  }

  /**
   * Reloads the current page
   */
  async reload(viewId: ViewId): Promise<void> {
    const webView = this.views.get(viewId);
    if (!webView) {
      throw new Error(`View ${viewId} not found`);
    }

    webView.webContents.reload();
  }

  /**
   * Stops loading the current page
   */
  async stop(viewId: ViewId): Promise<void> {
    const webView = this.views.get(viewId);
    if (!webView) {
      throw new Error(`View ${viewId} not found`);
    }

    webView.webContents.stop();
  }

  // ===================
  // VIEW STATE MANAGEMENT
  // ===================

  /**
   * Sets the bounds of a view
   */
  async setViewBounds(viewId: ViewId, bounds: Rectangle): Promise<void> {
    const webView = this.views.get(viewId);
    if (!webView) return;

    // Update metadata
    const metadata = this.viewMetadata.get(viewId);
    if (metadata) {
      metadata.bounds = bounds;
    } else {
      // This shouldn't happen as metadata should exist if view exists
      console.warn(`Metadata not found for view ${viewId}`);
    }

    // Apply bounds if view is visible
    if (webView.getVisible()) {
      webView.setBounds(bounds);
    }
  }

  /**
   * Sets the visibility of a view
   */
  async setViewVisibility(viewId: ViewId, isVisible: boolean): Promise<void> {
    const webView = this.views.get(viewId);
    if (!webView) return;

    const metadata = this.viewMetadata.get(viewId);
    if (metadata) {
      metadata.isVisible = isVisible;
    }

    if (isVisible) {
      // Hide other views first
      await this.hideAllViewsExcept(viewId);

      // Show this view
      if (metadata) {
        webView.setBounds(metadata.bounds);
      }
      webView.setVisible(true);
      this.activeView = viewId;

      // Update thread state
      const threadId = this.threadViewManager?.getThreadForView(viewId);
      if (threadId) {
        const state = this.threadViewManager.getThreadViewState(threadId);
        if (state) {
          state.activeViewId = viewId;
        }
      }
    } else {
      webView.setVisible(false);
      if (this.activeView === viewId) {
        this.activeView = null;
      }
    }
  }

  /**
   * Switches to a specific view
   */
  async switchToView(viewId: ViewId): Promise<void> {
    const webView = this.views.get(viewId);
    if (!webView) {
      console.warn(`Cannot switch to non-existent view: ${viewId}`);
      return;
    }

    // Hide all other views
    await this.hideAllViewsExcept(viewId);

    // Show the target view
    const metadata = this.viewMetadata.get(viewId);
    if (metadata) {
      webView.setBounds(metadata.bounds);
      webView.setVisible(true);
      metadata.isVisible = true;
    }

    this.activeView = viewId;

    // Update thread state
    const threadId = this.threadViewManager?.getThreadForView(viewId);
    if (threadId) {
      const state = this.threadViewManager.getThreadViewState(threadId);
      if (state) {
        state.activeViewId = viewId;
      }
    }
  }

  /**
   * Sets or clears the active view
   */
  async setActiveView(viewId: ViewId | null): Promise<void> {
    if (viewId) {
      await this.switchToView(viewId);
    } else {
      // Hide all views
      await this.hideAllViews();
      this.activeView = null;
    }
  }

  /**
   * Switches to a thread by activating its active view
   */
  async switchToThread(threadId: ThreadId): Promise<void> {
    // Get the active view for this thread
    const activeViewId = this.getActiveViewForThread(threadId);

    if (activeViewId) {
      await this.switchToView(activeViewId);
    } else {
      // No active view for this thread, hide all views
      await this.hideAllViews();
      this.activeView = null;
    }
  }

  // ===================
  // BROWSER ACTIONS
  // ===================

  /**
   * Captures a screenshot of a view
   */
  async captureScreenshot(viewId: ViewId): Promise<Buffer> {
    const webView = this.views.get(viewId);
    if (!webView) {
      throw new Error(`View ${viewId} not found`);
    }

    const image = await webView.webContents.capturePage();
    return image.toPNG();
  }

  /**
   * Executes JavaScript in a view
   */
  async executeScript(viewId: ViewId, script: string): Promise<unknown> {
    const webView = this.views.get(viewId);
    if (!webView) {
      throw new Error(`View ${viewId} not found`);
    }

    return webView.webContents.executeJavaScript(script);
  }

  /**
   * Executes a window function by name
   */
  async executeWindowFunction(
    viewId: ViewId,
    functionName: string,
    ...args: unknown[]
  ): Promise<ActionResult> {
    try {
      const argsString = args.map((arg) => JSON.stringify(arg)).join(", ");
      const script = `
        (function() {
          if (typeof window.${functionName} === 'function') {
            return window.${functionName}(${argsString});
          } else {
            throw new Error('Function ${functionName} not found');
          }
        })()
      `;
      const result = await this.executeScript(viewId, script);
      return { success: true, data: result };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  // ===================
  // ELEMENT INTERACTIONS
  // ===================

  /**
   * Clicks an element by hint ID
   */
  async clickElement(viewId: ViewId, elementId: number): Promise<ActionResult> {
    const result = await this.executeWindowFunction(
      viewId,
      "clickElementById",
      elementId
    );
    return { success: result.data === true, data: result.data };
  }

  /**
   * Types text into an element by hint ID
   */
  async typeText(
    viewId: ViewId,
    elementId: number,
    text: string
  ): Promise<ActionResult> {
    const result = await this.executeWindowFunction(
      viewId,
      "typeTextById",
      elementId,
      text
    );
    return result.success
      ? result
      : { success: false, error: "Failed to type text" };
  }

  /**
   * Shows hint overlays on interactive elements
   */
  async showHints(viewId: ViewId): Promise<void> {
    // First ensure hint detector is initialized
    const initResult = await this.executeWindowFunction(
      viewId,
      "initializeHintDetector"
    );

    if (!initResult.success) {
      console.warn("[BrowserViewService] Failed to initialize hint detector");
    }

    await this.executeWindowFunction(viewId, "showHints");
  }

  /**
   * Hides hint overlays
   */
  async hideHints(viewId: ViewId): Promise<void> {
    await this.executeWindowFunction(viewId, "hideHints");
  }

  /**
   * Gets all interactable elements in the viewport
   */
  async getPageElements(
    viewId: ViewId,
    options?: { viewportOnly?: boolean }
  ): Promise<ActionResult> {
    // First ensure hint detector is initialized
    const initResult = await this.executeWindowFunction(
      viewId,
      "initializeHintDetector"
    );

    if (!initResult.success) {
      console.warn("[BrowserViewService] Failed to initialize hint detector");
    }

    const viewportOnly = options?.viewportOnly ?? true;
    const result = await this.executeWindowFunction(
      viewId,
      "getInteractableElements",
      viewportOnly
    );
    return result.success ? { success: true, data: result.data || [] } : result;
  }

  // ===================
  // GETTERS (Synchronous for performance)
  // ===================

  getView(viewId: ViewId): WebContentsView | null {
    return this.views.get(viewId) || null;
  }

  getViewInfo(viewId: ViewId): ViewInfo | null {
    const metadata = this.viewMetadata.get(viewId);
    if (!metadata) return null;
    return {
      id: metadata.id,
      threadId: metadata.threadId,
      url: metadata.url,
      title: metadata.title,
      favicon: metadata.favicon,
    };
  }

  getViewMetadata(viewId: ViewId): ViewMetadata | null {
    return this.viewMetadata.get(viewId) || null;
  }

  getActiveView(): ViewId | null {
    return this.activeView;
  }

  getAllViews(): Map<ViewId, WebContentsView> {
    return new Map(this.views);
  }

  getActiveViewForThread(threadId: ThreadId): ViewId | null {
    if (!this.threadViewManager) return null;
    const state = this.threadViewManager.getThreadViewState(threadId);
    return state?.activeViewId || null;
  }

  getAllViewsForThread(threadId: ThreadId): ViewInfo[] {
    if (!this.threadViewManager) return [];
    const viewIds = this.threadViewManager.getViewsForThread(threadId);
    const views: ViewInfo[] = [];

    viewIds.forEach((viewId: ViewId) => {
      const info = this.getViewInfo(viewId);
      if (info) {
        views.push(info);
      }
    });

    return views;
  }

  // ===================
  // EVENT HANDLING
  // ===================

  onViewCreated(callback: (view: ViewInfo) => void): () => void {
    this.eventEmitter.on("created", callback);
    return () => this.eventEmitter.off("created", callback);
  }

  onViewUpdated(
    callback: (viewId: ViewId, updates: Partial<ViewInfo>) => void
  ): () => void {
    this.eventEmitter.on("updated", callback);
    return () => this.eventEmitter.off("updated", callback);
  }

  onViewDestroyed(callback: (viewId: ViewId) => void): () => void {
    this.eventEmitter.on("destroyed", callback);
    return () => this.eventEmitter.off("destroyed", callback);
  }

  // ===================
  // PRIVATE HELPERS
  // ===================

  /**
   * Hides all views except the specified one
   */
  private async hideAllViewsExcept(exceptViewId?: ViewId): Promise<void> {
    const hidePromises: Promise<void>[] = [];

    this.views.forEach((view, id) => {
      if (id !== exceptViewId && view.getVisible()) {
        hidePromises.push(
          Promise.resolve().then(() => {
            view.setVisible(false);
            const metadata = this.viewMetadata.get(id);
            if (metadata) {
              metadata.isVisible = false;
            }
          })
        );
      }
    });

    await Promise.all(hidePromises);
  }

  /**
   * Hides all views
   */
  private async hideAllViews(): Promise<void> {
    await this.hideAllViewsExcept();
  }

  /**
   * Updates view info
   */
  private updateViewInfo(viewId: ViewId, updates: Partial<ViewInfo>): void {
    const metadata = this.viewMetadata.get(viewId);
    if (!metadata) return;

    // Update the metadata with ViewInfo fields
    if (updates.url !== undefined) metadata.url = updates.url;
    if (updates.title !== undefined) metadata.title = updates.title;
    if (updates.favicon !== undefined) metadata.favicon = updates.favicon;

    this.eventEmitter.emit("updated", viewId, updates);
  }

  /**
   * Sets up event handlers for a web view
   */
  private async setupEventHandlers(
    webView: WebContentsView,
    viewId: ViewId
  ): Promise<(() => void)[]> {
    const cleanupHandlers: (() => void)[] = [];

    // Page load completion - inject scripts
    const loadHandler = async () => {
      try {
        // Inject index.js script wrapped in IIFE
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
    cleanupHandlers.push(() =>
      webView.webContents.off("did-finish-load", loadHandler)
    );

    // WebContents destroyed handler
    const destroyedHandler = () => {
      console.log(`WebContents for view ${viewId} was destroyed`);
      this.destroyView(viewId);
    };
    webView.webContents.on("destroyed", destroyedHandler);
    cleanupHandlers.push(() => {
      if (!webView.webContents.isDestroyed()) {
        webView.webContents.off("destroyed", destroyedHandler);
      }
    });

    // Navigation error handler
    const failLoadHandler = (
      _: Electron.Event,
      errorCode: number,
      errorDescription: string,
      validatedURL: string
    ) => {
      console.error(
        `Failed to load ${validatedURL} in view ${viewId}: ${errorDescription} (${errorCode})`
      );
    };
    webView.webContents.on("did-fail-load", failLoadHandler);
    cleanupHandlers.push(() =>
      webView.webContents.off("did-fail-load", failLoadHandler)
    );

    // Crash handler
    const crashHandler = (
      _: Electron.Event,
      details: Electron.RenderProcessGoneDetails
    ) => {
      console.error(`Renderer process crashed for view ${viewId}:`, details);
    };
    webView.webContents.on("render-process-gone", crashHandler);
    cleanupHandlers.push(() =>
      webView.webContents.off("render-process-gone", crashHandler)
    );

    return cleanupHandlers;
  }

  // ===================
  // CLEANUP
  // ===================

  /**
   * Destroys all views and cleans up resources
   */
  async destroy(): Promise<void> {
    // Destroy all views
    const destroyPromises = Array.from(this.views.keys()).map((viewId) =>
      this.destroyView(viewId)
    );
    await Promise.all(destroyPromises);

    this.views.clear();
    this.viewMetadata.clear();
    this.eventCleanupMap.clear();
    this.eventEmitter.removeAllListeners();
    this.activeView = null;
  }
}
