import { useEffect } from "react";
import { useAssistantRuntime } from "@assistant-ui/react";
import { useUiStore } from "@/stores/uiStore";

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
      if (containerBounds) {
        // Set visibility (now using send since it's one-way)
        window.ipcRenderer.send("threadview:setBounds", {
          bounds: containerBounds,
        });
      }

      // Set visibility (now using send since it's one-way)
      window.ipcRenderer.send("threadview:setVisibility", {
        isVisible,
      });
    };

    // Set visibility based on current container state
    updateVisibility(!!containerRef);

    // Cleanup function - hide view when hook unmounts
    return () => {
      updateVisibility(false);
    };
  }, [containerRef, runtime.threads.mainItem]);
}
