import type { UIActions, UIState, CoreState } from "../types";
import type {
  SetViewVisibilityCommand,
  SetViewBoundsCommand,
} from "../../../electron/shared/types/commands";
import {
  shouldUpdateViewBounds,
  createBoundsUpdatePayload,
  getContainerBounds,
} from "@/lib/bounds";

type StoreState = UIState & CoreState;
type GetState = () => StoreState;
type SetState = (
  partial: Partial<StoreState> | ((state: StoreState) => Partial<StoreState>)
) => void;

export const createUIActions = (set: SetState, get: GetState): UIActions => ({
  setExpandedTask: (taskId: string | null) => {
    set({ expandedTaskId: taskId });
    window.ipcRenderer.invoke("app:setExpandedTask", taskId);
  },

  setViewVisibility: (isHidden: boolean) => {
    const state = get();

    set({
      isViewHidden: isHidden,
    });

    if (state.activeViewId) {
      // When making view visible, update bounds BEFORE setting visibility
      if (!isHidden && !state.showSettings) {
        const bounds = state.containerRef
          ? getContainerBounds(state.containerRef)
          : state.containerBounds;

        if (bounds) {
          const boundsCommand = createBoundsUpdatePayload(
            state.activeViewId,
            bounds
          ) as SetViewBoundsCommand;
          // Set bounds first
          window.ipcRenderer.invoke("app:setViewBounds", boundsCommand).then(() => {
            // Then set visibility after bounds are updated
            const command: SetViewVisibilityCommand = {
              viewId: state.activeViewId,
              isHidden: isHidden,
            };
            window.ipcRenderer.invoke("app:setViewVisibility", command);
          });
        } else {
          // If no bounds available, just set visibility
          const command: SetViewVisibilityCommand = {
            viewId: state.activeViewId,
            isHidden: isHidden,
          };
          window.ipcRenderer.invoke("app:setViewVisibility", command);
        }
      } else {
        // When hiding or showing settings, just update visibility
        const command: SetViewVisibilityCommand = {
          viewId: state.activeViewId,
          isHidden: isHidden,
        };
        window.ipcRenderer.invoke("app:setViewVisibility", command);
      }
    }
  },

  setContainerRef: (ref) => {
    set({ containerRef: ref });
    // Update bounds immediately
    const actions = createUIActions(set, get);
    actions.updateContainerBounds();
  },

  updateContainerBounds: () => {
    const state = get();

    // Get real bounds from container ref
    const rect = state.containerRef
      ? getContainerBounds(state.containerRef)
      : null;

    set({ containerBounds: rect });

    // Update active view bounds
    if (shouldUpdateViewBounds(state) && rect) {
      const boundsCommand = createBoundsUpdatePayload(
        state.activeViewId!,
        rect
      ) as SetViewBoundsCommand;
      window.ipcRenderer.invoke("app:setViewBounds", boundsCommand);
    }
  },

  setShowSettings: (show: boolean) => {
    const state = get();
    set({ showSettings: show });

    // Hide/show the web view when toggling settings
    if (state.activeViewId) {
      const actions = createUIActions(set, get);
      actions.setViewVisibility(show);
    }
  },
});
