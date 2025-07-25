/**
 * Service interfaces for AuiThread architecture
 */
import type {
  ThreadId,
  ViewId,
  ThreadViewState,
  ThreadEvent,
  ViewEvent,
} from "../thread";

/**
 * Manages the relationship between assistant-ui threads and browser views
 */
export interface IAuiThreadViewManager {
  // Thread lifecycle
  onThreadCreated(threadId: ThreadId): Promise<void>;
  onThreadDeleted(threadId: ThreadId): Promise<void>;
  onThreadSwitched(threadId: ThreadId): Promise<void>;

  // View associations
  registerView(threadId: ThreadId, viewId: ViewId): Promise<void>;
  unregisterView(viewId: ViewId): Promise<void>;
  getViewsForThread(threadId: ThreadId): Set<ViewId>;
  getThreadForView(viewId: ViewId): ThreadId | null;

  // Thread state
  getActiveThread(): ThreadId | null;
  getThreadViewState(threadId: ThreadId): ThreadViewState | null;
  getAllThreadStates(): Map<ThreadId, ThreadViewState>;

  // Event subscriptions
  subscribeToThreadEvents(callback: (event: ThreadEvent) => void): () => void;
  subscribeToViewEvents(callback: (event: ViewEvent) => void): () => void;

  // Cleanup
  destroy(): Promise<void>;
}
