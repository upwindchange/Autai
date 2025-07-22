import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type { AppStore } from "./types";
import type { SelectPageCommand, SetViewBoundsCommand } from "../../electron/shared/types/commands";
import { createBackendActions } from "./actions/backendActions";
import { createUIActions } from "./actions/uiActions";
import { createNavigationActions } from "./actions/navigationActions";
import { createSyncActions } from "./actions/syncActions";
import { setupIpcListeners, processQueuedMessages } from "./ipcListeners";
import { loadInitialState } from "./initialization";
import { setupResizeObserver, cleanupResizeObserver } from "./resizeObserver";
import { shouldUpdateViewBounds, createBoundsUpdatePayload, getContainerBounds } from "@/lib/bounds";

// Set up IPC listeners before store creation
setupIpcListeners();

const useAppStore = create<AppStore>()(
  subscribeWithSelector((set, get) => ({
    // Initial state - Core
    tasks: new Map(),
    views: new Map(),
    agents: new Map(),
    activeTaskId: null,
    activeViewId: null,

    // Initial state - UI
    expandedTaskId: null,
    isViewHidden: false,
    containerRef: null,
    containerBounds: null,
    showSettings: false,

    // Initial state - Initialization
    isInitializing: true,
    initializationError: null,
    initializationRetryCount: 0,

    // Actions
    ...createBackendActions(),
    ...createUIActions(set, get),
    ...createNavigationActions(),
    ...createSyncActions(set, get),

    // Override selectPage to handle view bounds update
    selectPage: async (taskId: string, pageId: string) => {
      try {
        const command: SelectPageCommand = {
          taskId,
          pageId,
        };
        const result = await window.ipcRenderer.invoke("app:selectPage", command);
        if (!result.success) {
          console.error("Failed to select page:", result.error);
          return;
        }

        // Update view bounds for the newly selected view
        const state = get();
        if (shouldUpdateViewBounds(state)) {
          // Get real bounds from container ref if available, otherwise use stored bounds
          const bounds = state.containerRef
            ? getContainerBounds(state.containerRef)
            : state.containerBounds;

          const boundsCommand = createBoundsUpdatePayload(state.activeViewId!, bounds) as SetViewBoundsCommand;
          await window.ipcRenderer.invoke(
            "app:setViewBounds",
            boundsCommand
          );
        }
      } catch (error) {
        console.error("Error selecting page:", error);
      }
    },
  }))
);

// Process any queued IPC messages
processQueuedMessages({
  syncState: useAppStore.getState().syncState,
  handleStateChange: useAppStore.getState().handleStateChange,
});

// Start loading initial state
loadInitialState(0, {
  syncState: useAppStore.getState().syncState,
  setState: (state) => useAppStore.setState(state),
});

// Set up container bounds observer
const unsubscribeResizeObserver = setupResizeObserver(useAppStore);

// Export cleanup function
export const cleanup = () => {
  cleanupResizeObserver();
  unsubscribeResizeObserver();
};

export { useAppStore, cleanupResizeObserver };
export type { AppStore };