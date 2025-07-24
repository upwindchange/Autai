/**
 * Service interfaces for AuiThread architecture
 */

import { WebContentsView, Rectangle } from "electron";
import type {
  AuiThreadId,
  AuiViewId,
  AuiView,
  AuiViewMetadata,
  AuiThreadViewState,
  AuiThreadEvent,
  AuiViewEvent,
  BrowserAction,
  AuiViewResult,
} from "../auiThread";

/**
 * Manages the relationship between assistant-ui threads and browser views
 */
export interface IAuiThreadViewManager {
  // Thread lifecycle
  onThreadCreated(threadId: AuiThreadId): void;
  onThreadDeleted(threadId: AuiThreadId): void;
  onThreadSwitched(threadId: AuiThreadId): void;

  // View associations
  registerView(threadId: AuiThreadId, viewId: AuiViewId): void;
  unregisterView(viewId: AuiViewId): void;
  getViewsForThread(threadId: AuiThreadId): Set<AuiViewId>;
  getThreadForView(viewId: AuiViewId): AuiThreadId | null;

  // Thread state
  getActiveThread(): AuiThreadId | null;
  getThreadViewState(threadId: AuiThreadId): AuiThreadViewState | null;
  getAllThreadStates(): Map<AuiThreadId, AuiThreadViewState>;

  // Event subscriptions
  subscribeToThreadEvents(callback: (event: AuiThreadEvent) => void): () => void;
  subscribeToViewEvents(callback: (event: AuiViewEvent) => void): () => void;

  // Cleanup
  destroy(): void;
}

/**
 * Manages WebContentsView lifecycle and operations
 */
export interface IBrowserViewManager {
  // View lifecycle
  createView(config: {
    viewId: AuiViewId;
    url?: string;
    bounds?: Rectangle;
  }): WebContentsView;
  destroyView(viewId: AuiViewId): void;
  getView(viewId: AuiViewId): WebContentsView | null;
  getAllViews(): Map<AuiViewId, WebContentsView>;

  // Navigation
  navigateView(viewId: AuiViewId, url: string): Promise<void>;
  goBack(viewId: AuiViewId): Promise<boolean>;
  goForward(viewId: AuiViewId): Promise<boolean>;
  reload(viewId: AuiViewId): Promise<void>;
  stop(viewId: AuiViewId): void;

  // Script execution
  executeScript(viewId: AuiViewId, script: string): Promise<any>;
  executeAction(viewId: AuiViewId, action: BrowserAction): Promise<AuiViewResult>;

  // View properties
  getViewInfo(viewId: AuiViewId): AuiView | null;
  updateViewInfo(viewId: AuiViewId, updates: Partial<AuiView>): void;

  // Screenshot
  captureScreenshot(viewId: AuiViewId): Promise<Buffer>;

  // Event handling
  onViewCreated(callback: (view: AuiView) => void): () => void;
  onViewUpdated(callback: (viewId: AuiViewId, updates: Partial<AuiView>) => void): () => void;
  onViewDestroyed(callback: (viewId: AuiViewId) => void): () => void;

  // Cleanup
  destroy(): void;
}

/**
 * Coordinates between ThreadViewManager and BrowserViewManager
 */
export interface IViewOrchestrator {
  // View operations
  createViewForThread(threadId: AuiThreadId, target?: "tab" | "window"): Promise<AuiViewId>;
  closeView(viewId: AuiViewId): void;
  switchToView(viewId: AuiViewId): void;

  // Thread operations
  getActiveViewForThread(threadId: AuiThreadId): AuiViewId | null;
  getAllViewsForThread(threadId: AuiThreadId): AuiView[];
  switchToThread(threadId: AuiThreadId): void;

  // View state management
  setViewBounds(viewId: AuiViewId, bounds: Rectangle): void;
  setViewVisibility(viewId: AuiViewId, isVisible: boolean): void;
  getViewMetadata(viewId: AuiViewId): AuiViewMetadata | null;

  // Browser operations
  navigateView(viewId: AuiViewId, url: string): Promise<void>;
  executeViewAction(viewId: AuiViewId, action: BrowserAction): Promise<AuiViewResult>;

  // Active view management
  getActiveView(): AuiViewId | null;
  setActiveView(viewId: AuiViewId | null): void;

  // Initialize with services
  initialize(
    threadViewManager: IAuiThreadViewManager,
    browserViewManager: IBrowserViewManager
  ): void;

  // Cleanup
  destroy(): void;
}