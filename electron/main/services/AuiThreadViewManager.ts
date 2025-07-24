/**
 * Manages the relationship between assistant-ui threads and browser views
 */

import { EventEmitter } from "events";
import type {
  IAuiThreadViewManager,
  AuiThreadId,
  AuiViewId,
  AuiThreadViewState,
  AuiThreadEvent,
  AuiViewEvent,
} from "../../shared/types";

export class AuiThreadViewManager implements IAuiThreadViewManager {
  private threadViews = new Map<AuiThreadId, Set<AuiViewId>>();
  private viewThreads = new Map<AuiViewId, AuiThreadId>();
  private activeThread: AuiThreadId | null = null;
  private threadStates = new Map<AuiThreadId, AuiThreadViewState>();
  private eventEmitter = new EventEmitter();

  // Thread lifecycle
  onThreadCreated(threadId: AuiThreadId): void {
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

  onThreadDeleted(threadId: AuiThreadId): void {
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

  onThreadSwitched(threadId: AuiThreadId): void {
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
  registerView(threadId: AuiThreadId, viewId: AuiViewId): void {
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

  unregisterView(viewId: AuiViewId): void {
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

  getViewsForThread(threadId: AuiThreadId): Set<AuiViewId> {
    return this.threadViews.get(threadId) || new Set();
  }

  getThreadForView(viewId: AuiViewId): AuiThreadId | null {
    return this.viewThreads.get(viewId) || null;
  }

  // Thread state
  getActiveThread(): AuiThreadId | null {
    return this.activeThread;
  }

  getThreadViewState(threadId: AuiThreadId): AuiThreadViewState | null {
    return this.threadStates.get(threadId) || null;
  }

  getAllThreadStates(): Map<AuiThreadId, AuiThreadViewState> {
    return new Map(this.threadStates);
  }

  // Event subscriptions
  subscribeToThreadEvents(callback: (event: AuiThreadEvent) => void): () => void {
    this.eventEmitter.on("thread", callback);
    return () => this.eventEmitter.off("thread", callback);
  }

  subscribeToViewEvents(callback: (event: AuiViewEvent) => void): () => void {
    this.eventEmitter.on("view", callback);
    return () => this.eventEmitter.off("view", callback);
  }

  // Private methods
  private emitThreadEvent(event: AuiThreadEvent): void {
    this.eventEmitter.emit("thread", event);
  }

  private emitViewEvent(event: AuiViewEvent): void {
    this.eventEmitter.emit("view", event);
  }

  // Cleanup
  destroy(): void {
    // Clean up all threads
    Array.from(this.threadViews.keys()).forEach((threadId) => {
      this.onThreadDeleted(threadId);
    });

    this.threadViews.clear();
    this.viewThreads.clear();
    this.threadStates.clear();
    this.eventEmitter.removeAllListeners();
    this.activeThread = null;
  }
}