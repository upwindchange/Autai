import type { SyncActions, CoreState, UIState, InitState } from "../types";
import type {
  AppState,
  StateChangeEvent,
  SetViewBoundsCommand,
} from "../../../electron/shared/types";
import { objectToMap, restoreTaskPages } from "../utils";
import { loadInitialState, type InitializationState } from "../initialization";
import {
  shouldUpdateViewBounds,
  createBoundsUpdatePayload,
  getContainerBounds,
} from "@/lib/bounds";

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

        // Set initial bounds for the newly created view if it's active
        const currentState = get();
        if (
          event.view.id === currentState.activeViewId &&
          shouldUpdateViewBounds(currentState)
        ) {
          // Get real bounds from container ref
          const bounds = currentState.containerRef
            ? getContainerBounds(currentState.containerRef)
            : currentState.containerBounds;

          const boundsCommand = createBoundsUpdatePayload(
            event.view.id,
            bounds
          ) as SetViewBoundsCommand;
          window.ipcRenderer.invoke("app:setViewBounds", boundsCommand);
        }
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
          shouldUpdateViewBounds({
            ...currentState,
            activeViewId: event.viewId,
          })
        ) {
          // Get real bounds from container ref if available
          const bounds = currentState.containerRef
            ? getContainerBounds(currentState.containerRef)
            : currentState.containerBounds;

          const boundsCommand = createBoundsUpdatePayload(
            event.viewId,
            bounds
          ) as SetViewBoundsCommand;
          window.ipcRenderer.invoke("app:setViewBounds", boundsCommand);
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
