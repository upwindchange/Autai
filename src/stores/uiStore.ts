import { Rectangle } from "electron";
import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";

interface UiState {
  // Settings visibility
  showSettings: boolean;
  toggleSettings: () => void;
  setShowSettings: (show: boolean) => void;

  // Container management
  containerRef: HTMLDivElement | null;
  containerBounds: Rectangle | null;
  setContainerRef: (ref: HTMLDivElement | null) => void;
  setContainerBounds: (bounds: Rectangle | null) => void;
}

export const useUiStore = create<UiState>()(
  subscribeWithSelector((set) => ({
    // Settings state
    showSettings: false,
    toggleSettings: () =>
      set((state) => ({ showSettings: !state.showSettings })),
    setShowSettings: (show) => set({ showSettings: show }),

    // Container state
    containerRef: null,
    containerBounds: null,
    setContainerRef: (ref) => set({ containerRef: ref }),
    setContainerBounds: (bounds) => {
      set({ containerBounds: bounds });
      if (bounds) {
        // Set visibility (now using send since it's one-way)
        window.ipcRenderer.send("threadview:setBounds", {
          bounds,
        });
      }
    },
  }))
);
