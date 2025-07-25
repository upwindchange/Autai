/**
 * Service interfaces for AuiThread architecture
 */
import type {
  AuiThreadId,
  AuiViewId,
  AuiThreadViewState,
  AuiThreadEvent,
  AuiViewEvent,
} from "../auiThread";

/**
 * Manages the relationship between assistant-ui threads and browser views
 */
export interface IAuiThreadViewManager {
  // Thread lifecycle
  onThreadCreated(threadId: AuiThreadId): Promise<void>;
  onThreadDeleted(threadId: AuiThreadId): Promise<void>;
  onThreadSwitched(threadId: AuiThreadId): Promise<void>;

  // View associations
  registerView(threadId: AuiThreadId, viewId: AuiViewId): Promise<void>;
  unregisterView(viewId: AuiViewId): Promise<void>;
  getViewsForThread(threadId: AuiThreadId): Set<AuiViewId>;
  getThreadForView(viewId: AuiViewId): AuiThreadId | null;

  // Thread state
  getActiveThread(): AuiThreadId | null;
  getThreadViewState(threadId: AuiThreadId): AuiThreadViewState | null;
  getAllThreadStates(): Map<AuiThreadId, AuiThreadViewState>;

  // Event subscriptions
  subscribeToThreadEvents(
    callback: (event: AuiThreadEvent) => void
  ): () => void;
  subscribeToViewEvents(callback: (event: AuiViewEvent) => void): () => void;

  // Cleanup
  destroy(): Promise<void>;
}
