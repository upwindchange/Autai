import { Rectangle } from "electron";
import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";

export type SettingsSection = "providers" | "models" | "development" | "about";

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
	setUseBrowser: (useBrowser: boolean) => void;
	setWebSearch: (webSearch: boolean) => void;

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
		activeSettingsSection: "providers",
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
		setUseBrowser: (useBrowser) =>
			set((state) => ({
				useBrowser,
				// Mutually exclusive: if useBrowser is true, webSearch must be false
				webSearch: useBrowser ? false : state.webSearch,
			})),
		setWebSearch: (webSearch) =>
			set((state) => ({
				webSearch,
				// Mutually exclusive: if webSearch is true, useBrowser must be false
				useBrowser: webSearch ? false : state.useBrowser,
			})),

		// Session state (thread-based)
		sessionId: null,
		setSessionId: (sessionId) => set({ sessionId }),
	})),
);
