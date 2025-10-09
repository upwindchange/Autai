import type { ThreadId } from "@shared";

/**
 * Thread context provider for tools to access the current thread ID
 * during agent execution.
 */
class ThreadContextProvider {
  private static instance: ThreadContextProvider;
  private currentThreadId: ThreadId | null = null;

  private constructor() {}

  static getInstance(): ThreadContextProvider {
    if (!ThreadContextProvider.instance) {
      ThreadContextProvider.instance = new ThreadContextProvider();
    }
    return ThreadContextProvider.instance;
  }

  /**
   * Set the current thread ID for the ongoing operation
   */
  setCurrentThreadId(threadId: ThreadId | null): void {
    this.currentThreadId = threadId;
  }

  /**
   * Get the current thread ID
   */
  getCurrentThreadId(): ThreadId | null {
    return this.currentThreadId;
  }

  /**
   * Clear the current thread ID
   */
  clearCurrentThreadId(): void {
    this.currentThreadId = null;
  }

  /**
   * Get the current thread ID or throw an error if not set
   */
  requireCurrentThreadId(): ThreadId {
    if (!this.currentThreadId) {
      throw new Error("No current thread ID set. Tools require a thread context to operate.");
    }
    return this.currentThreadId;
  }
}

export const threadContextProvider = ThreadContextProvider.getInstance();