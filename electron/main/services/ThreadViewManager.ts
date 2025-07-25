/**
 * Manages the relationship between assistant-ui threads and browser views
 */

import { EventEmitter } from "events";
import type {
  IAuiThreadViewManager,
  ThreadId,
  ViewId,
  ThreadViewState,
  ThreadEvent,
  ViewEvent,
} from "../../shared/types";

export class ThreadViewManager implements IAuiThreadViewManager {
  private threadViews = new Map<ThreadId, Set<ViewId>>();
  private viewThreads = new Map<ViewId, ThreadId>();
  private activeThread: ThreadId | null = null;
  private threadStates = new Map<ThreadId, ThreadViewState>();
  private eventEmitter = new EventEmitter();

  // Thread lifecycle
  async onThreadCreated(threadId: ThreadId): Promise<void> {
    if (this.threadViews.has(threadId)) {
      console.warn(`Thread ${threadId} already exists`);
      return;
    }

    // Initialize thread with empty view set
    this.threadViews.set(threadId, new Set());
    this.threadStates.set(threadId, {
      threadId,
      viewIds: [],
      activeViewId: null,
    });

    // If this is the first thread, make it active
    if (!this.activeThread) {
      this.activeThread = threadId;
    }

    this.emitThreadEvent({
      type: "THREAD_CREATED",
      threadId,
    });
  }

  async onThreadDeleted(threadId: ThreadId): Promise<void> {
    const viewIds = this.threadViews.get(threadId);
    if (!viewIds) {
      console.warn(`Thread ${threadId} does not exist`);
      return;
    }

    // Clean up all views associated with the thread
    viewIds.forEach((viewId) => {
      this.viewThreads.delete(viewId);
      this.emitViewEvent({
        type: "VIEW_CLOSED",
        viewId,
      });
    });

    // Remove thread data
    this.threadViews.delete(threadId);
    this.threadStates.delete(threadId);

    // If this was the active thread, clear it
    if (this.activeThread === threadId) {
      this.activeThread = null;
    }

    this.emitThreadEvent({
      type: "THREAD_DELETED",
      threadId,
    });
  }

  async onThreadSwitched(threadId: ThreadId): Promise<void> {
    if (!this.threadViews.has(threadId)) {
      console.warn(`Cannot switch to non-existent thread ${threadId}`);
      return;
    }

    this.activeThread = threadId;
    this.emitThreadEvent({
      type: "THREAD_SWITCHED",
      threadId,
    });
  }

  // View associations
  async registerView(threadId: ThreadId, viewId: ViewId): Promise<void> {
    const viewSet = this.threadViews.get(threadId);
    if (!viewSet) {
      throw new Error(`Thread ${threadId} does not exist`);
    }

    // Add view to thread
    viewSet.add(viewId);
    this.viewThreads.set(viewId, threadId);

    // Update thread state
    const state = this.threadStates.get(threadId);
    if (state) {
      state.viewIds = Array.from(viewSet);
      // If no active view, make this one active
      if (!state.activeViewId) {
        state.activeViewId = viewId;
      }
    }
  }

  async unregisterView(viewId: ViewId): Promise<void> {
    const threadId = this.viewThreads.get(viewId);
    if (!threadId) {
      console.warn(`View ${viewId} is not registered`);
      return;
    }

    // Remove from thread's view set
    const viewSet = this.threadViews.get(threadId);
    if (viewSet) {
      viewSet.delete(viewId);

      // Update thread state
      const state = this.threadStates.get(threadId);
      if (state) {
        state.viewIds = Array.from(viewSet);
        // If this was the active view, clear it
        if (state.activeViewId === viewId) {
          state.activeViewId = state.viewIds[0] || null;
        }
      }
    }

    // Remove view-thread mapping
    this.viewThreads.delete(viewId);
  }

  getViewsForThread(threadId: ThreadId): Set<ViewId> {
    return this.threadViews.get(threadId) || new Set();
  }

  getThreadForView(viewId: ViewId): ThreadId | null {
    return this.viewThreads.get(viewId) || null;
  }

  // Thread state
  getActiveThread(): ThreadId | null {
    return this.activeThread;
  }

  getThreadViewState(threadId: ThreadId): ThreadViewState | null {
    return this.threadStates.get(threadId) || null;
  }

  getAllThreadStates(): Map<ThreadId, ThreadViewState> {
    return new Map(this.threadStates);
  }

  // Event subscriptions
  subscribeToThreadEvents(callback: (event: ThreadEvent) => void): () => void {
    this.eventEmitter.on("thread", callback);
    return () => this.eventEmitter.off("thread", callback);
  }

  subscribeToViewEvents(callback: (event: ViewEvent) => void): () => void {
    this.eventEmitter.on("view", callback);
    return () => this.eventEmitter.off("view", callback);
  }

  // Private methods
  private emitThreadEvent(event: ThreadEvent): void {
    this.eventEmitter.emit("thread", event);
  }

  private emitViewEvent(event: ViewEvent): void {
    this.eventEmitter.emit("view", event);
  }

  // Cleanup
  async destroy(): Promise<void> {
    // Clean up all threads
    await Promise.all(
      Array.from(this.threadViews.keys()).map((threadId) =>
        this.onThreadDeleted(threadId)
      )
    );

    this.threadViews.clear();
    this.viewThreads.clear();
    this.threadStates.clear();
    this.eventEmitter.removeAllListeners();
    this.activeThread = null;
  }
}
