import { IpcMainInvokeEvent } from "electron";
import { BaseBridge } from "./BaseBridge";
import type {
  SetViewBoundsCommand,
  SetViewVisibilityCommand,
} from "../../shared/types/index";
import type { WebViewService, StateManager } from "../services";

/**
 * Handles view-related IPC operations
 */
export class ViewBridge extends BaseBridge {
  private webViewService: WebViewService;
  private stateManager: StateManager;

  constructor(stateManager: StateManager, webViewService: WebViewService) {
    super();
    this.stateManager = stateManager;
    this.webViewService = webViewService;
  }

  setupHandlers(): void {
    // View bounds
    this.handle(
      "app:setViewBounds",
      async (_event: IpcMainInvokeEvent, command: SetViewBoundsCommand) => {
        this.webViewService.setViewBounds(command.viewId, command.bounds);
        return { success: true };
      }
    );

    // View visibility
    this.handle(
      "app:setViewVisibility",
      async (_event: IpcMainInvokeEvent, command: SetViewVisibilityCommand) => {
        this.webViewService.setViewVisibility(
          command.viewId,
          !command.isHidden
        );
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
        const webView = this.webViewService.getWebContentsViewById(
          command.viewId
        );
        if (!webView) return [];

        const viewportOnly = command.viewportOnly ?? true;
        const elements = await webView.webContents.executeJavaScript(
          `window.getInteractableElements ? window.getInteractableElements(${viewportOnly}) : []`
        );
        return elements || [];
      }
    );
  }

  /**
   * Update view bounds for all views based on container bounds
   */
  updateViewBounds(containerBounds: Electron.Rectangle): void {
    const activeViewId = this.stateManager.getActiveViewId();

    // Update bounds for active view only - visibility is handled separately
    if (activeViewId) {
      this.webViewService.setViewBounds(activeViewId, containerBounds);
    }
  }
}
