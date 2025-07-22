import type { StoreApi } from "zustand";
import type { AppStore } from "./types";

let resizeObserver: ResizeObserver | null = null;

export function setupResizeObserver(store: StoreApi<AppStore>) {
  // Use the subscribe method with selector from subscribeWithSelector middleware
  const unsubscribe = store.subscribe((state: AppStore) => {
    const containerRef = state.containerRef;

    // Clean up old observer
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }

    // Set up new observer
    if (containerRef?.current) {
      resizeObserver = new ResizeObserver(() => {
        store.getState().updateContainerBounds();
      });
      resizeObserver.observe(containerRef.current);
    }
  });

  return unsubscribe;
}

export function cleanupResizeObserver() {
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
}

// Set up cleanup on window unload
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", cleanupResizeObserver);
}
