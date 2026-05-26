import { useEffect } from "react";
import { useUiStore } from "@/stores/uiStore";
import log from "electron-log/renderer";

const logger = log.scope("useTabVisibility");

/**
 * Hook that syncs container mount/unmount state with tab visibility.
 * When the workspace container is mounted (split view active), the active
 * tab is shown. When unmounted, the tab is hidden.
 */
export function useTabVisibility() {
  const containerRef = useUiStore((s) => s.containerRef);

  useEffect(() => {
    const isVisible = !!containerRef;

    logger.debug("updating visibility", { isVisible });
    window.ipcRenderer.send("sessiontab:setVisibility", { isVisible });

    return () => {
      logger.debug("cleaning up, hiding tab");
      window.ipcRenderer.send("sessiontab:setVisibility", {
        isVisible: false,
      });
    };
  }, [containerRef]);
}
