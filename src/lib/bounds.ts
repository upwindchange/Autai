import type { RefObject } from "react";

/**
 * Rectangle type matching Electron's Rectangle interface
 */
export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Default bounds when container is not available
 * Using 1080p dimensions as requested
 */
export const DEFAULT_BOUNDS: Rectangle = {
  x: 0,
  y: 0,
  width: 1920,
  height: 1080,
};

/**
 * Gets bounds from container ref, returns null if unavailable
 */
export function getContainerBounds(
  containerRef: RefObject<HTMLDivElement | null>
): DOMRect | null {
  const container = containerRef?.current;
  if (!container) {
    return null;
  }
  return container.getBoundingClientRect();
}

/**
 * Gets electron-compatible bounds from container bounds or default
 */
export function getElectronBounds(containerBounds: DOMRect | null): Rectangle {
  if (!containerBounds) {
    return DEFAULT_BOUNDS;
  }

  return {
    x: Math.round(containerBounds.x),
    y: Math.round(containerBounds.y),
    width: Math.round(containerBounds.width),
    height: Math.round(containerBounds.height),
  };
}
/**
 * Checks if bounds should be updated based on app state
 */
export function shouldUpdateViewBounds(state: {
  activeViewId: string | null;
  isViewHidden: boolean;
  showSettings: boolean;
}): boolean {
  return Boolean(
    state.activeViewId && !state.isViewHidden && !state.showSettings
  );
}

/**
 * Creates a bounds update payload for IPC
 * Always returns valid bounds (either from container or default)
 */
export function createBoundsUpdatePayload(
  viewId: string,
  containerBounds: DOMRect | null
): { viewId: string; bounds: Rectangle } {
  return {
    viewId,
    bounds: getElectronBounds(containerBounds),
  };
}
