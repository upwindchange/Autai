import { WebContentsView, BrowserWindow, Rectangle } from "electron";
import { EventEmitter } from "events";
import type { ThreadId, ViewId, ThreadViewState } from "@shared/index";
import { getIndexScript } from "../scripts/indexLoader";

interface ViewMetadata {
  id: ViewId;
  threadId: ThreadId;
  url: string;
  bounds: Rectangle;
  frontendVisibility: boolean;
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
  private threadStates = new Map<ThreadId, ThreadViewState>();
  private activeThreadId: ThreadId | null = null;
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
      this.activeThreadId = threadId;
      return;
    }

    this.threadStates.set(threadId, {
      threadId,
      viewIds: [],
      activeViewId: null,
    });

    this.activeThreadId = threadId;
    // Create initial view for the thread
    const viewId = await this.createView({ threadId });
    
    // Set as active view for the thread
    const state = this.threadStates.get(threadId)!;
    state.activeViewId = viewId;
  }

  async switchThread(threadId: ThreadId): Promise<void> {
    // Hide all views from current thread
    if (this.activeThreadId) {
      await this.hideThreadViews(this.activeThreadId);
    }

    this.activeThreadId = threadId;

    // Show active view of new thread (respecting visibility rules)
    const state = this.threadStates.get(threadId);
    if (state?.activeViewId) {
      await this.updateViewVisibility(state.activeViewId);
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
      this.activeThreadId = null;
    }
  }

  // ===================
  // VIEW LIFECYCLE
  // ===================

  async createView(options: CreateViewOptions): Promise<ViewId> {
    const { threadId, url = "about:blank", bounds } = options;
    const viewId = `view-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

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
      bounds: bounds || { x: 0, y: 0, width: 1920, height: 1080 },
      frontendVisibility: false, // Default to not visible from frontend
      backendVisibility: true,   // Default to visible from backend
    });

    // Add to window but keep hidden initially
    this.win.contentView.addChildView(webView);
    this.updateViewVisibility(viewId);
    
    if (bounds) {
      webView.setBounds(bounds);
    }

    // Update thread state
    const threadState = this.threadStates.get(threadId);
    if (threadState) {
      threadState.viewIds.push(viewId);
    }

    // Load URL if provided
    if (url && url !== "about:blank") {
      await webView.webContents.loadURL(url);
    }
    
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
    webView.webContents.once("did-finish-load", loadHandler);

    console.log("threadview:created", viewId, threadId);
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
        console.error(`Error cleaning up WebContents for view ${viewId}:`, error);
      }
    }

    // Remove from window
    try {
      this.win.contentView.removeChildView(webView);
    } catch (error) {
      console.error(`Error removing view from window:`, error);
    }

    // Update thread state
    const threadState = this.threadStates.get(metadata.threadId);
    if (threadState) {
      threadState.viewIds = threadState.viewIds.filter(id => id !== viewId);
      if (threadState.activeViewId === viewId) {
        threadState.activeViewId = threadState.viewIds[0] || null;
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

  async setFrontendVisibility(viewId: ViewId, isVisible: boolean): Promise<void> {
    const metadata = this.viewMetadata.get(viewId);
    if (!metadata) return;

    metadata.frontendVisibility = isVisible;
    await this.updateViewVisibility(viewId);
  }

  async setBackendVisibility(viewId: ViewId, isVisible: boolean): Promise<void> {
    const metadata = this.viewMetadata.get(viewId);
    if (!metadata) return;

    metadata.backendVisibility = isVisible;
    await this.updateViewVisibility(viewId);
  }

  private async updateViewVisibility(viewId: ViewId): Promise<void> {
    const webView = this.views.get(viewId);
    const metadata = this.viewMetadata.get(viewId);
    if (!webView || !metadata) return;

    // Check if this view belongs to the active thread
    const isActiveThread = metadata.threadId === this.activeThreadId;
    const threadState = this.threadStates.get(metadata.threadId);
    const isActiveView = threadState?.activeViewId === viewId;

    console.log(`${metadata.threadId}, ${this.activeThreadId}, ${threadState?.activeViewId}, ${viewId}, ${metadata.frontendVisibility}, ${metadata.backendVisibility}`);
    
    // View is visible only if:
    // 1. It belongs to the active thread
    // 2. It's the active view of that thread
    // 3. Both frontend and backend visibility are true
    const shouldBeVisible = isActiveThread && isActiveView && 
                          metadata.frontendVisibility && 
                          metadata.backendVisibility;

    if (shouldBeVisible) {
      // Hide all other views first
      await this.hideAllViewsExcept(viewId);
      
      // Show this view
      webView.setBounds(metadata.bounds);
      webView.setVisible(true);
      console.log(`view ${viewId} is set to be visible`);
      
    } else {
      webView.setVisible(false);
      console.log(`view ${viewId} is set to be invisible`);
    }
  }
  
  async setBounds(viewId: ViewId, bounds: Rectangle): Promise<void> {
    const webView = this.views.get(viewId);
    const metadata = this.viewMetadata.get(viewId);
    if (!webView || !metadata) return;
    
    metadata.bounds = bounds;
    
    // Apply bounds if view is visible
    if (webView.getVisible()) {
      webView.setBounds(bounds);
      console.log(`view ${viewId} bounds is set to ${bounds}`);
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
        hidePromises.push(
          Promise.resolve().then(() => {
            this.setBackendVisibility(viewId, false);
          })
        );
      }
    });

    await Promise.all(hidePromises);
  }

  private async hideThreadViews(threadId: ThreadId): Promise<void> {
    const state = this.threadStates.get(threadId);
    if (!state) return;

    for (const viewId of state.viewIds) {
      const webView = this.views.get(viewId);
      if (webView?.getVisible()) {
        this.setBackendVisibility(viewId, false);
      }
    }
  }

  // ===================
  // CLEANUP
  // ===================

  async destroy(): Promise<void> {
    // Destroy all views
    const destroyPromises = Array.from(this.views.keys()).map(viewId => 
      this.destroyView(viewId)
    );
    await Promise.all(destroyPromises);

    this.views.clear();
    this.viewMetadata.clear();
    this.threadStates.clear();
    this.removeAllListeners();
    this.activeThreadId = null;
  }
}