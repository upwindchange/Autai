/**
 * Coordinates between ThreadViewManager and BrowserViewManager
 */

import { Rectangle, BrowserWindow } from "electron";
import type {
  IViewOrchestrator,
  IAuiThreadViewManager,
  IBrowserViewManager,
  AuiThreadId,
  AuiViewId,
  AuiView,
  AuiViewMetadata,
  BrowserAction,
  AuiViewResult,
} from "../../shared/types";

export class ViewOrchestrator implements IViewOrchestrator {
  private threadViewManager!: IAuiThreadViewManager;
  private browserViewManager!: IBrowserViewManager;
  private activeView: AuiViewId | null = null;
  private viewMetadata = new Map<AuiViewId, AuiViewMetadata>();
  private win: BrowserWindow;

  constructor(win: BrowserWindow) {
    this.win = win;
  }

  initialize(
    threadViewManager: IAuiThreadViewManager,
    browserViewManager: IBrowserViewManager
  ): void {
    this.threadViewManager = threadViewManager;
    this.browserViewManager = browserViewManager;

    // Subscribe to thread events
    this.threadViewManager.subscribeToThreadEvents((event) => {
      switch (event.type) {
        case "THREAD_SWITCHED":
          this.switchToThread(event.threadId);
          break;
        case "THREAD_DELETED":
          // Views are cleaned up by thread manager
          break;
      }
    });

    // Subscribe to view events from browser manager
    this.browserViewManager.onViewDestroyed((viewId) => {
      this.threadViewManager.unregisterView(viewId);
      this.viewMetadata.delete(viewId);
      if (this.activeView === viewId) {
        this.activeView = null;
      }
    });
  }

  // View operations
  async createViewForThread(
    threadId: AuiThreadId,
    target?: "tab" | "window"
  ): Promise<AuiViewId> {
    // Generate unique view ID
    const viewId = `view-${Date.now()}-${Math.random()
      .toString(36)
      .substring(2, 11)}`;

    // Create the view
    const webView = this.browserViewManager.createView({
      viewId,
      url: "about:blank",
    });

    // Update view info with thread ID
    this.browserViewManager.updateViewInfo(viewId, { threadId });

    // Register with thread manager
    this.threadViewManager.registerView(threadId, viewId);

    // Initialize metadata
    this.viewMetadata.set(viewId, {
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      isVisible: false,
    });

    // If this is a window target, handle window creation
    if (target === "window") {
      // TODO: Implement window creation logic
      console.log("Window creation not yet implemented");
    }

    // If this thread is active and has no active view, activate this one
    if (
      this.threadViewManager.getActiveThread() === threadId &&
      !this.getActiveViewForThread(threadId)
    ) {
      this.switchToView(viewId);
    }

    return viewId;
  }

  closeView(viewId: AuiViewId): void {
    const threadId = this.threadViewManager.getThreadForView(viewId);
    if (!threadId) return;

    // Destroy the view
    this.browserViewManager.destroyView(viewId);

    // If this was the active view, switch to another view in the thread
    if (this.activeView === viewId) {
      const remainingViews = this.threadViewManager.getViewsForThread(threadId);
      const nextView = Array.from(remainingViews)[0];
      if (nextView) {
        this.switchToView(nextView);
      } else {
        this.activeView = null;
      }
    }
  }

  switchToView(viewId: AuiViewId): void {
    const webView = this.browserViewManager.getView(viewId);
    if (!webView) {
      console.warn(`Cannot switch to non-existent view: ${viewId}`);
      return;
    }

    // Hide all views
    this.browserViewManager.getAllViews().forEach((view, id) => {
      if (view.getVisible()) {
        view.setVisible(false);
        const metadata = this.viewMetadata.get(id);
        if (metadata) {
          metadata.isVisible = false;
        }
      }
    });

    // Show the target view
    const metadata = this.viewMetadata.get(viewId);
    if (metadata) {
      webView.setBounds(metadata.bounds);
      webView.setVisible(true);
      metadata.isVisible = true;
    }

    this.activeView = viewId;

    // Update thread state
    const threadId = this.threadViewManager.getThreadForView(viewId);
    if (threadId) {
      const state = this.threadViewManager.getThreadViewState(threadId);
      if (state) {
        state.activeViewId = viewId;
      }
    }
  }

  // Thread operations
  getActiveViewForThread(threadId: AuiThreadId): AuiViewId | null {
    const state = this.threadViewManager.getThreadViewState(threadId);
    return state?.activeViewId || null;
  }

  getAllViewsForThread(threadId: AuiThreadId): AuiView[] {
    const viewIds = this.threadViewManager.getViewsForThread(threadId);
    const views: AuiView[] = [];

    viewIds.forEach((viewId) => {
      const info = this.browserViewManager.getViewInfo(viewId);
      if (info) {
        views.push(info);
      }
    });

    return views;
  }

  switchToThread(threadId: AuiThreadId): void {
    // Get the active view for this thread
    const activeViewId = this.getActiveViewForThread(threadId);
    
    if (activeViewId) {
      this.switchToView(activeViewId);
    } else {
      // No active view for this thread, hide all views
      this.browserViewManager.getAllViews().forEach((view) => {
        if (view.getVisible()) {
          view.setVisible(false);
        }
      });
      this.activeView = null;
    }
  }

  // View state management
  setViewBounds(viewId: AuiViewId, bounds: Rectangle): void {
    const webView = this.browserViewManager.getView(viewId);
    if (!webView) return;

    // Update metadata
    const metadata = this.viewMetadata.get(viewId);
    if (metadata) {
      metadata.bounds = bounds;
    } else {
      this.viewMetadata.set(viewId, { bounds, isVisible: false });
    }

    // Apply bounds if view is visible
    if (webView.getVisible()) {
      webView.setBounds(bounds);
    }
  }

  setViewVisibility(viewId: AuiViewId, isVisible: boolean): void {
    const webView = this.browserViewManager.getView(viewId);
    if (!webView) return;

    const metadata = this.viewMetadata.get(viewId);
    if (metadata) {
      metadata.isVisible = isVisible;
    }

    if (isVisible) {
      // Hide other views first
      this.browserViewManager.getAllViews().forEach((view, id) => {
        if (id !== viewId && view.getVisible()) {
          view.setVisible(false);
          const meta = this.viewMetadata.get(id);
          if (meta) {
            meta.isVisible = false;
          }
        }
      });

      // Show this view
      if (metadata) {
        webView.setBounds(metadata.bounds);
      }
      webView.setVisible(true);
      this.activeView = viewId;
    } else {
      webView.setVisible(false);
      if (this.activeView === viewId) {
        this.activeView = null;
      }
    }
  }

  getViewMetadata(viewId: AuiViewId): AuiViewMetadata | null {
    return this.viewMetadata.get(viewId) || null;
  }

  // Browser operations
  async navigateView(viewId: AuiViewId, url: string): Promise<void> {
    await this.browserViewManager.navigateView(viewId, url);
  }

  async executeViewAction(
    viewId: AuiViewId,
    action: BrowserAction
  ): Promise<AuiViewResult> {
    return this.browserViewManager.executeAction(viewId, action);
  }

  // Active view management
  getActiveView(): AuiViewId | null {
    return this.activeView;
  }

  setActiveView(viewId: AuiViewId | null): void {
    if (viewId) {
      this.switchToView(viewId);
    } else {
      // Hide all views
      this.browserViewManager.getAllViews().forEach((view) => {
        if (view.getVisible()) {
          view.setVisible(false);
        }
      });
      this.activeView = null;
    }
  }

  // Cleanup
  destroy(): void {
    this.viewMetadata.clear();
    this.activeView = null;
  }
}