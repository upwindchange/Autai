import { create } from "zustand";
import type { ThreadConfig, Thread } from "./types";

interface ThreadManagerState {
  threads: Map<string, Thread>;
  activeThreadId: string | null;
  createThread: (config: ThreadConfig) => Thread;
  getThread: (taskId: string) => Thread | undefined;
  removeThread: (taskId: string) => void;
  setActiveThread: (taskId: string | null) => void;
  updateThread: (taskId: string, updates: Partial<Thread>) => void;
  getAllThreads: () => Map<string, Thread>;
}

export const useThreadManager = create<ThreadManagerState>((set, get) => ({
  threads: new Map(),
  activeThreadId: null,

  createThread: (config: ThreadConfig) => {
    const thread: Thread = {
      id: `thread-${config.taskId}`,
      taskId: config.taskId,
      title: config.title || `Task ${config.taskId}`,
      messages: [],
      isLoading: false,
    };

    set((state) => ({
      threads: new Map(state.threads).set(config.taskId, thread),
    }));

    return thread;
  },

  getThread: (taskId: string) => {
    return get().threads.get(taskId);
  },

  removeThread: (taskId: string) => {
    set((state) => {
      const newThreads = new Map(state.threads);
      newThreads.delete(taskId);
      return {
        threads: newThreads,
        activeThreadId:
          state.activeThreadId === taskId ? null : state.activeThreadId,
      };
    });
  },

  setActiveThread: (taskId: string | null) => {
    set({ activeThreadId: taskId });
  },

  updateThread: (taskId: string, updates: Partial<Thread>) => {
    set((state) => {
      const thread = state.threads.get(taskId);
      if (!thread) return state;

      const updatedThread = { ...thread, ...updates };
      const newThreads = new Map(state.threads);
      newThreads.set(taskId, updatedThread);

      return { threads: newThreads };
    });
  },

  getAllThreads: () => {
    return get().threads;
  },
}));