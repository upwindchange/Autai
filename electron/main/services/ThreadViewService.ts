import { WebContentsView, BrowserWindow, Rectangle } from "electron";
import { EventEmitter } from "events";
import type { ThreadId, ViewId, ThreadViewState } from "@shared/index";
import { getIndexScript } from "@/scripts/indexLoader";

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
  private views = new Map<ViewId, WebContentsView>();
  private viewMetadata = new Map<ViewId, ViewMetadata>();
  private viewBounds: Rectangle = { x: 0, y: 0, width: 1920, height: 1080 };
  private threadStates = new Map<ThreadId, ThreadViewState>();
  private activeThreadId: ThreadId | null = null;
  private activeView: WebContentsView | null = null;
  private frontendVisibility: boolean = false;
  private win: BrowserWindow;

  constructor(win: BrowserWindow) {
    super();
    this.win = win;
  }

  // ===================
  // THREAD LIFECYCLE
  // ===================

  async createThread(threadId: ThreadId): Promise<void> {
    if (this.threadStates.has(threadId)) {
      console.log(`Thread ${threadId} already exists, switching to it`);
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
    console.log(`Thread ${threadId} created`);

    // Create initial view and set as active view for the thread
    const viewId = await this.createView({ threadId });
    const state = this.threadStates.get(threadId)!;
    state.activeViewId = viewId;
    this.activeView = this.views.get(viewId) || null;
    console.log(`Initial view ${viewId} created for thread ${threadId}`);
  }

  async switchThread(threadId: ThreadId): Promise<void> {
    console.log(`Switching from thread ${this.activeThreadId} to ${threadId}`);

    // Hide all views from current thread
    if (this.activeThreadId) {
      await this.hideThreadViews(this.activeThreadId);
    }

    this.activeThreadId = threadId;
    console.log(`Active thread set to ${threadId}`);

    // Show active view of new thread (respecting visibility rules)
    const activeViewId = this.getActiveViewForThread(threadId);
    if (activeViewId) {
      this.activeView = this.views.get(activeViewId) || null;
      console.log(`Active view for thread ${threadId} is ${activeViewId}`);
      await this.setBackendVisibility(activeViewId, true);
    } else {
      // No active view for this thread, clear the active view reference
      this.activeView = null;
      console.log(`No active view found for thread ${threadId}`);
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
    console.log("init welcome page loading");
    await webView.webContents.loadFile("public/welcome.html");
    console.log("welcome page loaded");

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
        console.log(`Successfully injected scripts for view ${viewId}`);
      } catch (error) {
        console.error("Failed to inject scripts:", error);
      }
    });

    console.log("createView", viewId, threadId);
    this.emit("threadview:created", { viewId, threadId });
    return viewId;
  }

  async destroyView(viewId: ViewId): Promise<void> {
    const webView = this.views.get(viewId);
    const metadata = this.viewMetadata.get(viewId);
    if (!webView || !metadata) return;

    // Stop and cleanup WebContents
    if (webView.webContents && !webView.webContents.isDestroyed()) {
      try {
        webView.webContents.stop();
        webView.webContents.removeAllListeners();
        webView.webContents.close({ waitForBeforeUnload: false });
        webView.webContents.forcefullyCrashRenderer();
      } catch (error) {
        console.error(
          `Error cleaning up WebContents for view ${viewId}:`,
          error
        );
      }
    }

    // Remove from window
    try {
      this.win.contentView.removeChildView(webView);
    } catch (error) {
      console.error(`Error removing view from window:`, error);
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

    this.emit("threadview:destroyed", viewId);
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
      console.log(
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

    console.log(`Updating visibility for view ${viewId}:`, {
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
      console.log(`view ${viewId} is set to be visible`);
    } else {
      webView.setVisible(false);
      console.log(`view ${viewId} is set to be invisible`);
    }
  }

  async setBounds(bounds: Rectangle): Promise<void> {
    console.log(`Setting bounds to:`, bounds);
    this.viewBounds = bounds;
    // Update bounds for the active view if it exists
    if (this.activeView) {
      this.activeView.setBounds(bounds);
      console.log(`Bounds updated for active view`);
    } else {
      console.log(`No active view to update bounds`);
    }
  }

  // ===================
  // GETTERS
  // ===================

  getView(viewId: ViewId): WebContentsView | null {
    return this.views.get(viewId) || null;
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
    // Delete all threads (which will destroy their views)
    const deletePromises = Array.from(this.threadStates.keys()).map(
      (threadId) => this.deleteThread(threadId)
    );
    await Promise.all(deletePromises);

    // Clean up any remaining views and metadata
    this.views.clear();
    this.viewMetadata.clear();
    this.threadStates.clear();
    this.removeAllListeners();
    this.activeThreadId = null;
    this.activeView = null;
  }
}
