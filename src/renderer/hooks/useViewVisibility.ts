import { useEffect } from "react";
import { useAssistantRuntime } from "@assistant-ui/react";
import { useUiStore } from "@/stores/uiStore";
import log from 'electron-log/renderer';

const logger = log.scope('useViewVisibility');

/**
 * Hook that syncs container mount/unmount state with view visibility.
 * When the container is mounted (split view active), the current thread's active view is made visible.
 * When unmounted, the view is hidden.
 *
 * The backend handles view switching between threads via threadview:switched events.
 */
export function useViewVisibility() {
  const { containerRef, containerBounds } = useUiStore();
  const runtime = useAssistantRuntime();

  useEffect(() => {
    const updateVisibility = async (isVisible: boolean) => {
      logger.debug("updating visibility", { isVisible, hasContainerBounds: !!containerBounds });

      // if (containerBounds) {
      //   logger.debug('sending bounds ipc', { containerBounds });
      //   // Set visibility (now using send since it's one-way)
      //   window.ipcRenderer.send("threadview:setBounds", {
      //     bounds: containerBounds,
      //   });
      // }

      logger.debug("sending visibility ipc", { isVisible });
      // Set visibility (now using send since it's one-way)
      window.ipcRenderer.send("threadview:setVisibility", {
        isVisible,
      });
    };

    // Set visibility based on current container state
    logger.debug("initializing visibility", { hasContainerRef: !!containerRef });
    updateVisibility(!!containerRef);

    // Cleanup function - hide view when hook unmounts
    return () => {
      logger.debug("cleaning up, hiding view");
      updateVisibility(false);
    };
  }, [containerRef, runtime.threads.mainItem]);
}
