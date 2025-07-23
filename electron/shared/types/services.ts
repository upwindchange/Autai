/**
 * Service interface types to decouple service dependencies
 */

import type { View } from './core';

/**
 * Interface for view management operations
 * This decouples StateManager from WebViewService implementation
 */
export interface IViewManager {
  createView(taskId: string, pageId: string, url: string): Promise<View | null>;
  destroyView(viewId: string): void;
  setActiveView(viewId: string | null, bounds?: Electron.Rectangle): void;
}