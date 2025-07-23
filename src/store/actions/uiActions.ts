import type { UIActions, UIState, CoreState } from "../types";
import type {
  SetViewVisibilityCommand,
  SetViewBoundsCommand,
  SetActiveViewCommand,
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
      // Get current bounds for when showing the view
      const bounds = !isHidden && state.containerRef
        ? getContainerBounds(state.containerRef)
        : null;

      const command: SetViewVisibilityCommand = {
        viewId: state.activeViewId,
        isHidden: isHidden,
        bounds: bounds ? createBoundsUpdatePayload(state.activeViewId, bounds).bounds : undefined,
      };
      
      window.ipcRenderer.invoke("app:setViewVisibility", command);
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

    // Update active view bounds if visible
    if (state.activeViewId && !state.isViewHidden && !state.showSettings && rect) {
      const boundsCommand = createBoundsUpdatePayload(
        state.activeViewId,
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
