import type { SyncActions, CoreState, UIState, InitState } from "../types";
import type {
  AppState,
  StateChangeEvent,
} from "../../../electron/shared/types";
import { objectToMap, restoreTaskPages } from "../utils";
import { loadInitialState, type InitializationState } from "../initialization";

type StoreState = CoreState & UIState & InitState & SyncActions;
type GetState = () => StoreState;
type SetState = (
  partial: Partial<StoreState> | ((state: StoreState) => Partial<StoreState>)
) => void;

export const createSyncActions = (
  set: SetState,
  get: GetState
): SyncActions => ({
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
          activeTaskId: event.task.id, // Auto-select newly created task
        });
        break;
      }

      case "TASK_DELETED": {
        const newTasks = new Map(state.tasks);
        newTasks.delete(event.taskId);
        
        // If this was the last task, clear activeTaskId
        const updates: Partial<AppState> = { tasks: newTasks };
        if (newTasks.size === 0) {
          updates.activeTaskId = null;
        } else if (state.activeTaskId === event.taskId) {
          // If we deleted the active task but there are other tasks,
          // select the first available task
          const firstTask = Array.from(newTasks.keys())[0];
          updates.activeTaskId = firstTask;
        }
        
        set(updates);
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

  retryInitialization: async () => {
    set({
      initializationRetryCount: 0,
      initializationError: null,
    });

    const handlers = {
      syncState: get().syncState,
      setState: (state: Partial<InitializationState>) => set(state),
    };

    await loadInitialState(0, handlers);
  },
});
