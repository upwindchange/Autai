import { useEffect } from "react";
import { useAuiState } from "@assistant-ui/react";
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
  const containerRef = useUiStore((s) => s.containerRef);
  const showSettings = useUiStore((s) => s.showSettings);
  const mainTabId = useAuiState(({ threads }) => threads.mainThreadId);

  // Use settings-session when settings is active, otherwise use thread session
  const sessionId = showSettings ? "settings-session" : mainTabId;

  useEffect(() => {
    const updateVisibility = async (isVisible: boolean) => {
      logger.debug("updating visibility", {
        isVisible,
        sessionId,
      });

      logger.debug("sending visibility ipc", {
        isVisible,
        sessionId,
      });
      // Set visibility (now using send since it's one-way)
      window.ipcRenderer.send("sessiontab:setVisibility", {
        isVisible,
        sessionId,
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
  }, [containerRef, sessionId]);
}
