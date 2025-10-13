import { WebContentsView, BrowserWindow, Rectangle } from "electron";
import { EventEmitter } from "events";
import type { ThreadId, ViewId, ThreadViewState } from "@shared";
import { getIndexScript } from "@/scripts/indexLoader";
import { DomService } from "@/services";
import log from "electron-log/main";

interface ViewMetadata {
  id: ViewId;
  threadId: ThreadId;
  url: string;
  backendVisibility: boolean;
}

interface CreateViewOptions {
  threadId: ThreadId;
  url?: string;
  bounds?: Rectangle;
}

export class ThreadViewService extends EventEmitter {
  private static instance: ThreadViewService | null = null;
  private views = new Map<ViewId, WebContentsView>();
  private viewMetadata = new Map<ViewId, ViewMetadata>();
  private domServices = new Map<ViewId, DomService>();
  private viewBounds: Rectangle = { x: 0, y: 0, width: 1920, height: 1080 };
  private threadStates = new Map<ThreadId, ThreadViewState>();
  public activeThreadId: ThreadId | null = null;
  private activeView: WebContentsView | null = null;
  private frontendVisibility: boolean = false;
  private win: BrowserWindow;
  private logger = log.scope("ThreadViewService");

  private constructor(win: BrowserWindow) {
    super();
    this.win = win;
  }

  static getInstance(win?: BrowserWindow): ThreadViewService {
    if (!ThreadViewService.instance) {
      if (!win) {
        throw new Error(
          "BrowserWindow instance required for first initialization"
        );
      }
      ThreadViewService.instance = new ThreadViewService(win);
    }
    return ThreadViewService.instance;
  }

  static destroyInstance(): void {
    if (ThreadViewService.instance) {
      ThreadViewService.instance.removeAllListeners();
      ThreadViewService.instance = null;
    }
  }

  // ===================
  // THREAD LIFECYCLE
  // ===================

  async createThread(threadId: ThreadId): Promise<void> {
    if (this.threadStates.has(threadId)) {
      this.logger.info(`Thread ${threadId} already exists, switching to it`);
      this.activeThreadId = threadId;
      return;
    }

    // Initialize thread state
    this.threadStates.set(threadId, {
      threadId,
      viewIds: [],
      activeViewId: null,
    });

    this.activeThreadId = threadId;
    this.logger.info(`Thread ${threadId} created`);

    // Create initial view and set as active view for the thread
    const viewId = await this.createView({ threadId });
    const state = this.threadStates.get(threadId)!;
    state.activeViewId = viewId;
    this.activeView = this.views.get(viewId) || null;
    this.logger.info(`Initial view ${viewId} created for thread ${threadId}`);
  }

  async switchThread(threadId: ThreadId): Promise<void> {
    this.logger.info(
      `Switching from thread ${this.activeThreadId} to ${threadId}`
    );

    // Hide all views from current thread
    if (this.activeThreadId) {
      await this.hideThreadViews(this.activeThreadId);
    }

    this.activeThreadId = threadId;
    this.logger.debug(`Active thread set to ${threadId}`);

    // Show active view of new thread (respecting visibility rules)
    const activeViewId = this.getActiveViewForThread(threadId);
    if (activeViewId) {
      this.activeView = this.views.get(activeViewId) || null;
      this.logger.debug(
        `Active view for thread ${threadId} is ${activeViewId}`
      );
      await this.setBackendVisibility(activeViewId, true);
    } else {
      // No active view for this thread, clear the active view reference
      this.activeView = null;
      this.logger.debug(`No active view found for thread ${threadId}`);
    }
  }

  async deleteThread(threadId: ThreadId): Promise<void> {
    const state = this.threadStates.get(threadId);
    if (!state) return;

    // Destroy all views for this thread
    for (const viewId of state.viewIds) {
      await this.destroyView(viewId);
    }

    this.threadStates.delete(threadId);

    // Clear active thread if it was deleted
    if (this.activeThreadId === threadId) {
      // Get the first available thread as the new active thread
      const firstState = this.threadStates.values().next().value;
      this.activeThreadId = firstState?.threadId || null;
      if (firstState?.activeViewId) {
        this.activeView = this.views.get(firstState.activeViewId) || null;
      } else {
        this.activeView = null;
      }
    }
  }

  // ===================
  // VIEW LIFECYCLE
  // ===================

  async createView(options: CreateViewOptions): Promise<ViewId> {
    const { threadId, url = "https://find.quantimpulse.com", bounds } = options;
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

    // Store view and metadata
    this.views.set(viewId, webView);
    this.viewMetadata.set(viewId, {
      id: viewId,
      threadId,
      url,
      backendVisibility: true, // Default to visible from backend
    });

    // Create and store DomService for this view
    const domService = new DomService(webView.webContents);
    this.domServices.set(viewId, domService);

    if (bounds) {
      this.viewBounds = bounds;
    }

    // Add to window but keep hidden initially
    this.win.contentView.addChildView(webView);
    this.updateViewVisibility(viewId);

    // Update thread state
    const threadState = this.threadStates.get(threadId);
    if (threadState) {
      threadState.viewIds.push(viewId);
      // If this is the first view for the thread, set it as active
      if (threadState.viewIds.length === 1) {
        threadState.activeViewId = viewId;
        // If this thread is the active thread, update activeView reference
        if (this.activeThreadId === threadId) {
          this.activeView = webView;
        }
      }
    }

    // Load welcome page
    this.logger.debug("init welcome page loading");
    await webView.webContents.loadFile("resources/welcome.html");
    this.logger.debug("welcome page loaded");

    // Page load completion - inject scripts
    webView.webContents.once("did-finish-load", async () => {
      try {
        // Inject index.js script wrapped in IIFE
        const indexScript = getIndexScript();
        const wrappedIndexScript = `
          (function() {
            window.buildDomTree = ${indexScript};
          })();
        `;
        await webView.webContents.executeJavaScript(wrappedIndexScript);
        this.logger.debug(`Successfully injected scripts for view ${viewId}`);
      } catch (error) {
        this.logger.error("Failed to inject scripts:", error);
      }
    });

    this.logger.info("createView", viewId, threadId);
    this.emit("threadview:created", { viewId, threadId });
    return viewId;
  }

  async destroyView(viewId: ViewId): Promise<void> {
    this.logger.info(`Destroying view ${viewId}`);

    const webView = this.views.get(viewId);
    const metadata = this.viewMetadata.get(viewId);
    if (!webView || !metadata) {
      // Even if we don't have the view, still try to clean up from storage
      this.views.delete(viewId);
      this.viewMetadata.delete(viewId);
      return;
    }

    try {
      // Stop and cleanup WebContents
      if (webView.webContents && !webView.webContents.isDestroyed()) {
        try {
          this.logger.debug(`Stopping webContents for view ${viewId}`);
          webView.webContents.stop();
          webView.webContents.removeAllListeners();
          webView.webContents.close({ waitForBeforeUnload: false });
          webView.webContents.forcefullyCrashRenderer();
          this.logger.debug(`WebContents for view ${viewId} stopped`);
        } catch (error) {
          this.logger.error(
            `Error cleaning up WebContents for view ${viewId}:`,
            error
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `Error in webContents cleanup for view ${viewId}:`,
        error
      );
    }

    try {
      // Remove from window only if window still exists and isn't destroyed
      if (this.win && !this.win.isDestroyed()) {
        this.logger.debug(`Removing view ${viewId} from window`);
        this.win.contentView.removeChildView(webView);
        this.logger.debug(`View ${viewId} removed from window`);
      } else {
        this.logger.debug(
          `Window is destroyed, skipping view removal for ${viewId}`
        );
      }
    } catch (error) {
      this.logger.error(`Error removing view ${viewId} from window:`, error);
    }

    // Update thread state
    const state = this.threadStates.get(metadata.threadId);
    if (state) {
      // Remove viewId from thread's viewIds array
      const viewIndex = state.viewIds.indexOf(viewId);
      if (viewIndex > -1) {
        state.viewIds.splice(viewIndex, 1);
      }

      // If this was the active view, select a new active view
      if (state.activeViewId === viewId) {
        state.activeViewId = state.viewIds.length > 0 ? state.viewIds[0] : null;
        if (this.activeThreadId === metadata.threadId) {
          this.activeView = state.activeViewId
            ? this.views.get(state.activeViewId) || null
            : null;
        }
      }
    }

    // Clean up storage
    this.views.delete(viewId);
    this.viewMetadata.delete(viewId);
    this.domServices.delete(viewId);

    this.emit("threadview:destroyed", viewId);
    this.logger.info(`View ${viewId} destroyed successfully`);
  }

  // ===================
  // VISIBILITY MANAGEMENT
  // ===================

  async setFrontendVisibility(isVisible: boolean): Promise<void> {
    if (this.activeThreadId) {
      const viewId = this.threadStates.get(this.activeThreadId)?.activeViewId;
      if (viewId) {
        this.frontendVisibility = isVisible;
        await this.updateViewVisibility(viewId);
      }
    }
  }

  async setBackendVisibility(
    viewId: ViewId,
    isVisible: boolean
  ): Promise<void> {
    const metadata = this.viewMetadata.get(viewId);
    if (!metadata) return;

    metadata.backendVisibility = isVisible;
    await this.updateViewVisibility(viewId);
  }

  private async updateViewVisibility(viewId: ViewId): Promise<void> {
    const webView = this.views.get(viewId);
    const metadata = this.viewMetadata.get(viewId);
    if (!webView || !metadata) {
      this.logger.warn(
        `Cannot update visibility for view ${viewId}: view or metadata not found`
      );
      return;
    }

    // Check if this view belongs to the active thread
    const isActiveThread = metadata.threadId === this.activeThreadId;
    const threadState = this.threadStates.get(metadata.threadId);
    const isActiveView = threadState?.activeViewId === viewId;

    // View is visible only if:
    // 1. It belongs to the active thread
    // 2. It's the active view of that thread
    // 3. Both frontend and backend visibility are true
    const shouldBeVisible =
      isActiveThread &&
      isActiveView &&
      this.frontendVisibility &&
      metadata.backendVisibility;

    this.logger.debug(`Updating visibility for view ${viewId}:`, {
      isActiveThread,
      isActiveView,
      frontendVisibility: this.frontendVisibility,
      backendVisibility: metadata.backendVisibility,
      shouldBeVisible,
    });

    if (shouldBeVisible) {
      // Hide all other views first
      await this.hideAllViewsExcept(viewId);

      // Show this view
      webView.setBounds(this.viewBounds);
      webView.setVisible(true);
      this.logger.debug(`view ${viewId} is set to be visible`);
    } else {
      webView.setVisible(false);
      this.logger.debug(`view ${viewId} is set to be invisible`);
    }
  }

  async setBounds(bounds: Rectangle): Promise<void> {
    this.logger.debug(`Setting bounds to:`, bounds);
    this.viewBounds = bounds;
    // Update bounds for the active view if it exists
    if (this.activeView) {
      this.activeView.setBounds(bounds);
      this.logger.debug(`Bounds updated for active view`);
    } else {
      this.logger.debug(`No active view to update bounds`);
    }
  }

  // ===================
  // GETTERS
  // ===================

  getView(viewId: ViewId): WebContentsView | null {
    return this.views.get(viewId) || null;
  }

  getDomService(viewId: ViewId): DomService | null {
    return this.domServices.get(viewId) || null;
  }

  getActiveViewForThread(threadId: ThreadId): ViewId | null {
    const state = this.threadStates.get(threadId);
    return state?.activeViewId || null;
  }

  getThreadViewState(threadId: ThreadId): ThreadViewState | null {
    return this.threadStates.get(threadId) || null;
  }

  getViewsForThread(threadId: ThreadId): ViewId[] {
    const state = this.threadStates.get(threadId);
    return state?.viewIds || [];
  }

  getAllThreadIds(): ThreadId[] {
    return Array.from(this.threadStates.keys());
  }

  getAllViewMetadata(threadId: ThreadId): ViewMetadata[] {
    const state = this.threadStates.get(threadId);
    if (!state) return [];

    return state.viewIds
      .map((viewId) => this.viewMetadata.get(viewId))
      .filter((metadata): metadata is ViewMetadata => metadata !== undefined);
  }

  getViewMetadata(viewId: ViewId): ViewMetadata | null {
    return this.viewMetadata.get(viewId) || null;
  }

  // ===================
  // PRIVATE HELPERS
  // ===================

  private async hideAllViewsExcept(exceptViewId?: ViewId): Promise<void> {
    const hidePromises: Promise<void>[] = [];

    this.views.forEach((view, viewId) => {
      if (viewId !== exceptViewId && view.getVisible()) {
        // Use setBackendVisibility to properly track the reason for hiding
        hidePromises.push(this.setBackendVisibility(viewId, false));
      }
    });

    await Promise.all(hidePromises);
  }

  private async hideThreadViews(threadId: ThreadId): Promise<void> {
    const state = this.threadStates.get(threadId);
    if (!state) return;

    // Hide all views for this thread by setting backend visibility to false
    const hidePromises: Promise<void>[] = [];
    for (const viewId of state.viewIds) {
      const webView = this.views.get(viewId);
      if (webView?.getVisible()) {
        hidePromises.push(this.setBackendVisibility(viewId, false));
      }
    }

    await Promise.all(hidePromises);
  }

  // ===================
  // CLEANUP
  // ===================
  async destroy(): Promise<void> {
    try {
      // Delete all threads (which will destroy their views)
      const deletePromises = Array.from(this.threadStates.keys()).map(
        (threadId) => this.deleteThread(threadId)
      );
      await Promise.all(deletePromises);

      // Force cleanup of any remaining views
      for (const [viewId, _] of this.views) {
        try {
          this.logger.debug(`Force cleanup of view ${viewId}`);
          this.destroyView(viewId);
        } catch (error) {
          this.logger.error(`Error destroying view ${viewId}:`, error);
        }
      }
    } catch (error) {
      this.logger.error("Error during ThreadViewService.destroy():", error);
    } finally {
      // Still clean up what we can
      this.views.clear();
      this.viewMetadata.clear();
      this.domServices.clear();
      this.threadStates.clear();
      this.removeAllListeners();
      this.activeThreadId = null;
      this.activeView = null;
    }
  }
}
