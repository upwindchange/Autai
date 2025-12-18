import { useEffect } from "react";
import { useAssistantState } from "@assistant-ui/react";
import { useUiStore } from "@/stores/uiStore";
import log from "electron-log/renderer";

const logger = log.scope("useTabVisibility");

/**
 * Hook that syncs container mount/unmount state with tab visibility.
 * When the container is mounted (split tab active), the current thread's active tab is made visible.
 * When unmounted, the tab is hidden.
 *
 * The backend handles tab switching between threads via sessiontab:switched events.
 */
export function useTabVisibility() {
	const { containerRef, containerBounds } = useUiStore();
	const mainTabId = useAssistantState(({ threads }) => threads.mainThreadId);

	useEffect(() => {
		const updateVisibility = async (isVisible: boolean) => {
			logger.debug("updating visibility", {
				isVisible,
				hasContainerBounds: !!containerBounds,
			});

			// if (containerBounds) {
			//   logger.debug('sending bounds ipc', { containerBounds });
			//   // Set visibility (now using send since it's one-way)
			//   window.ipcRenderer.send("sessiontab:setBounds", {
			//     bounds: containerBounds,
			//   });
			// }

			logger.debug("sending visibility ipc", { isVisible });
			// Set visibility (now using send since it's one-way)
			window.ipcRenderer.send("sessiontab:setVisibility", {
				isVisible,
			});
		};

		// Set visibility based on current container state
		logger.debug("initializing visibility", {
			hasContainerRef: !!containerRef,
		});
		updateVisibility(!!containerRef);

		// Cleanup function - hide tab when hook unmounts
		return () => {
			logger.debug("cleaning up, hiding tab");
			updateVisibility(false);
		};
	}, [containerRef, mainTabId]);
}
