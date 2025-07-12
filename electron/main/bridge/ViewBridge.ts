import { IpcMainInvokeEvent } from "electron";
import { BaseBridge } from "./BaseBridge";
import type { SetViewBoundsCommand, SetViewVisibilityCommand } from "../../shared/types/index";

/**
 * Handles view-related IPC operations
 */
export class ViewBridge extends BaseBridge {
  setupHandlers(): void {
    // View bounds
    this.handle(
      "app:setViewBounds",
      async (_event: IpcMainInvokeEvent, command: SetViewBoundsCommand) => {
        this.stateManager.setViewBounds(command.viewId, command.bounds);
        return { success: true };
      }
    );

    // View visibility
    this.handle(
      "app:setViewVisibility",
      async (
        _event: IpcMainInvokeEvent,
        command: SetViewVisibilityCommand
      ) => {
        // Use the StateManager's method which handles visibility properly
        this.stateManager.setViewVisibility(command.viewId, !command.isHidden);
        return { success: true };
      }
    );

    // Get interactable elements (for AI agent)
    this.handle(
      "app:getInteractableElements",
      async (
        _event: IpcMainInvokeEvent,
        command: { viewId: string; viewportOnly?: boolean }
      ) => {
        const webView = this.stateManager.getWebContentsView(command.viewId);
        if (!webView) return [];

        const viewportOnly = command.viewportOnly ?? true;
        const elements = await webView.webContents.executeJavaScript(
          `window.getInteractableElements ? window.getInteractableElements(${viewportOnly}) : []`
        );
        return elements || [];
      }
    );

    // Click element by ID (for AI agent)
    this.handle(
      "app:clickElement",
      async (
        _event: IpcMainInvokeEvent,
        command: { viewId: string; elementId: number; viewportOnly?: boolean }
      ) => {
        const webView = this.stateManager.getWebContentsView(command.viewId);
        if (!webView) return false;

        const viewportOnly = command.viewportOnly ?? true;
        const result = await webView.webContents.executeJavaScript(
          `window.clickElementById ? window.clickElementById(${command.elementId}, ${viewportOnly}) : false`
        );
        return result;
      }
    );
  }

  /**
   * Update view bounds for all views based on container bounds
   */
  updateViewBounds(containerBounds: Electron.Rectangle): void {
    const state = this.stateManager.getFullState();
    const activeViewId = state.activeViewId;

    // Update bounds for active view only - visibility is handled separately
    if (activeViewId) {
      const view = state.views[activeViewId];
      if (view) {
        this.stateManager.setViewBounds(view.id, containerBounds);
      }
    }
  }
}
