import { Rectangle } from "electron";
import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";

export type SettingsSection =
  | "general"
  | "providers"
  | "aiAgents"
  | "threads"
  | "development"
  | "about";

interface UiState {
  // Settings visibility
  showSettings: boolean;
  toggleSettings: () => void;
  setShowSettings: (show: boolean) => void;

  // Settings navigation
  activeSettingsSection: SettingsSection;
  setActiveSettingsSection: (section: SettingsSection) => void;

  // Container management
  containerRef: HTMLDivElement | null;
  containerBounds: Rectangle | null;
  setContainerRef: (ref: HTMLDivElement | null) => void;
  setContainerBounds: (bounds: Rectangle | null) => void;

  // Browser toggle state
  useBrowser: boolean;
  webSearch: boolean;
  deepResearch: boolean;
  quickSearch: boolean;
  setUseBrowser: (useBrowser: boolean) => void;
  setWebSearch: (webSearch: boolean) => void;
  setDeepResearch: (deepResearch: boolean) => void;
  setQuickSearch: (quickSearch: boolean) => void;

  // Split view state
  showSplitView: boolean;
  setShowSplitView: (show: boolean) => void;
  toggleSplitView: () => void;

  // Session state (thread-based)
  sessionId: string | null;
  setSessionId: (sessionId: string | null) => void;
}

export const useUiStore = create<UiState>()(
  subscribeWithSelector((set) => ({
    // Settings state
    showSettings: false,
    toggleSettings: () =>
      set((state) => ({ showSettings: !state.showSettings })),
    setShowSettings: (show) => set({ showSettings: show }),

    // Settings navigation
    activeSettingsSection: "general",
    setActiveSettingsSection: (section) =>
      set({ activeSettingsSection: section }),

    // Container state
    containerRef: null,
    containerBounds: null,
    setContainerRef: (ref) => set({ containerRef: ref }),
    setContainerBounds: (bounds) => {
      set({ containerBounds: bounds });
      if (bounds) {
        // Set visibility (now using send since it's one-way)
        window.ipcRenderer.send("sessiontab:setBounds", {
          bounds,
        });
      }
    },

    // Browser toggle state
    useBrowser: false,
    webSearch: false,
    deepResearch: false,
    quickSearch: false,
    setUseBrowser: (useBrowser) =>
      set((state) => ({
        useBrowser,
        webSearch: useBrowser ? false : state.webSearch,
        deepResearch: useBrowser ? false : state.deepResearch,
        quickSearch: useBrowser ? false : state.quickSearch,
      })),
    setWebSearch: (webSearch) =>
      set((state) => ({
        webSearch,
        useBrowser: webSearch ? false : state.useBrowser,
        deepResearch: webSearch ? state.deepResearch : false,
        quickSearch: webSearch ? state.quickSearch : false,
      })),
    setDeepResearch: (deepResearch) =>
      set((state) => ({
        deepResearch,
        quickSearch: deepResearch ? false : state.quickSearch,
      })),
    setQuickSearch: (quickSearch) =>
      set((state) => ({
        quickSearch,
        deepResearch: quickSearch ? false : state.deepResearch,
      })),

    // Split view state
    showSplitView: false,
    setShowSplitView: (show) => set({ showSplitView: show }),
    toggleSplitView: () =>
      set((state) => ({ showSplitView: !state.showSplitView })),

    // Session state (thread-based)
    sessionId: null,
    setSessionId: (sessionId) => set({ sessionId }),
  })),
);
