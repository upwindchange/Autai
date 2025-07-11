import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type {
  Task,
  View,
  Agent,
  AppState,
  StateChangeEvent,
} from "../../electron/shared/types";
import type { RefObject } from "react";

interface AppStore {
  // State from backend
  tasks: Map<string, Task>;
  views: Map<string, View>;
  agents: Map<string, Agent>;
  activeTaskId: string | null;
  activeViewId: string | null;

  // UI-only state
  expandedTaskId: string | null;
  isViewHidden: boolean;
  viewHiddenReasons: Set<string>; // Track which components want the view hidden
  containerRef: RefObject<HTMLDivElement | null> | null;
  containerBounds: DOMRect | null;

  // Actions - Backend operations
  createTask: (title?: string, initialUrl?: string) => Promise<void>;
  deleteTask: (taskId: string) => Promise<void>;
  addPage: (taskId: string, url: string) => Promise<void>;
  deletePage: (taskId: string, pageId: string) => Promise<void>;
  selectPage: (taskId: string, pageId: string) => Promise<void>;
  navigate: (pageId: string, url: string) => Promise<void>;

  // Actions - UI operations
  setExpandedTask: (taskId: string | null) => void;
  setViewVisibility: (isHidden: boolean, reason?: string) => void;
  setContainerRef: (ref: RefObject<HTMLDivElement | null>) => void;
  updateContainerBounds: () => void;

  // Actions - State sync
  syncState: (state: AppState) => void;
  handleStateChange: (event: StateChangeEvent) => void;

  // Navigation actions
  goBack: () => Promise<void>;
  goForward: () => Promise<void>;
  reload: () => Promise<void>;
  stop: () => Promise<void>;
}

// Helper to convert plain objects back to Maps
function objectToMap<T>(obj: Record<string, T>): Map<string, T> {
  const map = new Map<string, T>();
  Object.entries(obj).forEach(([key, value]) => {
    map.set(key, value);
  });
  return map;
}

// Helper to restore page Maps in tasks
function restoreTaskPages(task: Task): Task {
  return {
    ...task,
    pages:
      task.pages instanceof Map ? task.pages : objectToMap(task.pages as Record<string, import("../../electron/shared/types").Page>),
  };
}

const useAppStore = create<AppStore>()(
  subscribeWithSelector((set, get) => ({
    // Initial state
    tasks: new Map(),
    views: new Map(),
    agents: new Map(),
    activeTaskId: null,
    activeViewId: null,
    expandedTaskId: null,
    isViewHidden: false,
    viewHiddenReasons: new Set(),
    containerRef: null,
    containerBounds: null,

    // Backend operations
    createTask: async (title?: string, initialUrl?: string) => {
      try {
        // Default to Reddit or Amazon for testing
        const defaultUrls = [
          "https://www.reddit.com",
          "https://www.amazon.com",
        ];
        const defaultUrl =
          initialUrl ||
          defaultUrls[Math.floor(Math.random() * defaultUrls.length)];

        const result = await window.ipcRenderer.invoke("app:createTask", {
          title: title || "New Task",
          initialUrl: defaultUrl,
        });

        if (!result.success) {
          console.error("Failed to create task:", result.error);
        }
      } catch (error) {
        console.error("Error creating task:", error);
      }
    },

    deleteTask: async (taskId: string) => {
      try {
        const result = await window.ipcRenderer.invoke("app:deleteTask", {
          taskId,
        });
        if (!result.success) {
          console.error("Failed to delete task:", result.error);
        }
      } catch (error) {
        console.error("Error deleting task:", error);
      }
    },

    addPage: async (taskId: string, url: string) => {
      try {
        const result = await window.ipcRenderer.invoke("app:addPage", {
          taskId,
          url,
        });
        if (!result.success) {
          console.error("Failed to add page:", result.error);
        }
      } catch (error) {
        console.error("Error adding page:", error);
      }
    },

    deletePage: async (taskId: string, pageId: string) => {
      try {
        const result = await window.ipcRenderer.invoke("app:deletePage", {
          taskId,
          pageId,
        });
        if (!result.success) {
          console.error("Failed to delete page:", result.error);
        }
      } catch (error) {
        console.error("Error deleting page:", error);
      }
    },

    selectPage: async (taskId: string, pageId: string) => {
      try {
        const result = await window.ipcRenderer.invoke("app:selectPage", {
          taskId,
          pageId,
        });
        if (!result.success) {
          console.error("Failed to select page:", result.error);
          return;
        }

        // Update view bounds for the newly selected view
        const state = get();
        if (
          state.activeViewId &&
          state.containerBounds &&
          !state.isViewHidden
        ) {
          await window.ipcRenderer.invoke("app:setViewBounds", {
            viewId: state.activeViewId,
            bounds: {
              x: Math.round(state.containerBounds.x),
              y: Math.round(state.containerBounds.y),
              width: Math.round(state.containerBounds.width),
              height: Math.round(state.containerBounds.height),
            },
          });
        }
      } catch (error) {
        console.error("Error selecting page:", error);
      }
    },

    navigate: async (pageId: string, url: string) => {
      try {
        const result = await window.ipcRenderer.invoke("app:navigate", {
          pageId,
          url,
        });
        if (!result.success) {
          console.error("Failed to navigate:", result.error);
        }
      } catch (error) {
        console.error("Error navigating:", error);
      }
    },

    // UI operations
    setExpandedTask: (taskId: string | null) => {
      set({ expandedTaskId: taskId });
      window.ipcRenderer.invoke("app:setExpandedTask", taskId);
    },

    setViewVisibility: (isHidden: boolean, reason: string = "default") => {
      const state = get();
      const reasons = new Set(state.viewHiddenReasons);

      if (isHidden) {
        reasons.add(reason);
      } else {
        reasons.delete(reason);
      }

      // View should be hidden if ANY component wants it hidden
      const shouldBeHidden = reasons.size > 0;

      set({
        viewHiddenReasons: reasons,
        isViewHidden: shouldBeHidden,
      });

      if (state.activeViewId) {
        // Use the View's setVisible API instead of manipulating bounds
        window.ipcRenderer.invoke("app:setViewVisibility", {
          viewId: state.activeViewId,
          isHidden: shouldBeHidden,
        });
      }
    },

    setContainerRef: (ref: RefObject<HTMLDivElement | null>) => {
      set({ containerRef: ref });
      // Update bounds immediately
      get().updateContainerBounds();
    },

    updateContainerBounds: () => {
      const state = get();
      const container = state.containerRef?.current;

      if (!container) {
        set({ containerBounds: null });
        return;
      }

      const rect = container.getBoundingClientRect();
      set({ containerBounds: rect });

      // Update active view bounds
      if (state.activeViewId && !state.isViewHidden) {
        window.ipcRenderer.invoke("app:setViewBounds", {
          viewId: state.activeViewId,
          bounds: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
        });
      }
    },

    // State sync
    syncState: (state: AppState) => {
      const tasks = objectToMap(state.tasks);
      tasks.forEach((task, id) => {
        tasks.set(id, restoreTaskPages(task));
      });

      set({
        tasks,
        views: objectToMap(state.views),
        agents: objectToMap(state.agents),
        activeTaskId: state.activeTaskId,
        activeViewId: state.activeViewId,
      });
    },

    handleStateChange: (event: StateChangeEvent) => {
      const state = get();

      switch (event.type) {
        case "TASK_CREATED": {
          state.tasks.set(event.task.id, restoreTaskPages(event.task));
          set({
            tasks: new Map(state.tasks),
            expandedTaskId: event.task.id, // Auto-expand newly created task
          });
          break;
        }

        case "TASK_DELETED": {
          state.tasks.delete(event.taskId);
          set({ tasks: new Map(state.tasks) });
          break;
        }

        case "TASK_UPDATED": {
          const task = state.tasks.get(event.taskId);
          if (task) {
            Object.assign(task, event.updates);
            set({ tasks: new Map(state.tasks) });
          }
          break;
        }

        case "PAGE_ADDED": {
          const taskForPage = state.tasks.get(event.taskId);
          if (taskForPage) {
            taskForPage.pages.set(event.page.id, event.page);
            set({ tasks: new Map(state.tasks) });
          }
          break;
        }

        case "PAGE_REMOVED": {
          const taskForRemoval = state.tasks.get(event.taskId);
          if (taskForRemoval) {
            taskForRemoval.pages.delete(event.pageId);
            set({ tasks: new Map(state.tasks) });
          }
          break;
        }

        case "PAGE_UPDATED": {
          const taskForUpdate = state.tasks.get(event.taskId);
          const page = taskForUpdate?.pages.get(event.pageId);
          if (page) {
            Object.assign(page, event.updates);
            set({ tasks: new Map(state.tasks) });
          }
          break;
        }

        case "VIEW_CREATED": {
          state.views.set(event.view.id, event.view);
          set({ views: new Map(state.views) });
          break;
        }

        case "VIEW_DELETED": {
          state.views.delete(event.viewId);
          set({ views: new Map(state.views) });
          break;
        }

        case "VIEW_UPDATED": {
          const view = state.views.get(event.viewId);
          if (view) {
            Object.assign(view, event.updates);
            set({ views: new Map(state.views) });
          }
          break;
        }

        case "ACTIVE_VIEW_CHANGED": {
          set({ activeViewId: event.viewId });
          // Update bounds for the newly active view
          const currentState = get();
          if (
            event.viewId &&
            currentState.containerBounds &&
            !currentState.isViewHidden
          ) {
            window.ipcRenderer.invoke("app:setViewBounds", {
              viewId: event.viewId,
              bounds: {
                x: Math.round(currentState.containerBounds.x),
                y: Math.round(currentState.containerBounds.y),
                width: Math.round(currentState.containerBounds.width),
                height: Math.round(currentState.containerBounds.height),
              },
            });
          }
          break;
        }

        case "ACTIVE_TASK_CHANGED": {
          set({ activeTaskId: event.taskId });
          break;
        }

        case "AGENT_CREATED": {
          state.agents.set(event.agent.id, event.agent);
          set({ agents: new Map(state.agents) });
          break;
        }

        case "AGENT_DELETED": {
          state.agents.delete(event.agentId);
          set({ agents: new Map(state.agents) });
          break;
        }

        case "AGENT_STATUS_CHANGED": {
          const agent = state.agents.get(event.agentId);
          if (agent) {
            agent.status = event.status;
            set({ agents: new Map(state.agents) });
          }
          break;
        }
      }
    },

    // Navigation actions
    goBack: async () => {
      const viewId = get().activeViewId;
      if (!viewId) return;

      try {
        const result = await window.ipcRenderer.invoke("app:goBack", viewId);
        if (!result.success) {
          console.error("Failed to go back:", result.error);
        }
      } catch (error) {
        console.error("Error going back:", error);
      }
    },

    goForward: async () => {
      const viewId = get().activeViewId;
      if (!viewId) return;

      try {
        const result = await window.ipcRenderer.invoke("app:goForward", viewId);
        if (!result.success) {
          console.error("Failed to go forward:", result.error);
        }
      } catch (error) {
        console.error("Error going forward:", error);
      }
    },

    reload: async () => {
      const viewId = get().activeViewId;
      if (!viewId) return;

      try {
        const result = await window.ipcRenderer.invoke("app:reload", viewId);
        if (!result.success) {
          console.error("Failed to reload:", result.error);
        }
      } catch (error) {
        console.error("Error reloading:", error);
      }
    },

    stop: async () => {
      const viewId = get().activeViewId;
      if (!viewId) return;

      try {
        const result = await window.ipcRenderer.invoke("app:stop", viewId);
        if (!result.success) {
          console.error("Failed to stop:", result.error);
        }
      } catch (error) {
        console.error("Error stopping:", error);
      }
    },
  }))
);

// Set up IPC listeners
window.ipcRenderer.on("state:sync", (_event, state: AppState) => {
  useAppStore.getState().syncState(state);
});

window.ipcRenderer.on("state:change", (_event, event: StateChangeEvent) => {
  useAppStore.getState().handleStateChange(event);
});

// Get initial state
window.ipcRenderer.invoke("app:getState").then((state: AppState) => {
  useAppStore.getState().syncState(state);
});

// Set up container bounds observer
let resizeObserver: ResizeObserver | null = null;

useAppStore.subscribe(
  (state) => state.containerRef,
  (containerRef) => {
    // Clean up old observer
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }

    // Set up new observer
    if (containerRef?.current) {
      resizeObserver = new ResizeObserver(() => {
        useAppStore.getState().updateContainerBounds();
      });
      resizeObserver.observe(containerRef.current);
    }
  }
);

export { useAppStore };
export type { AppStore };
