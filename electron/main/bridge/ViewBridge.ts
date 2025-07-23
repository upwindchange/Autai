import { IpcMainInvokeEvent } from "electron";
import { BaseBridge } from "./BaseBridge";
import type {
  SetViewBoundsCommand,
  SetViewVisibilityCommand,
} from "../../shared/types";
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
    // Update view bounds
    this.handle(
      "app:setViewBounds",
      async (_event: IpcMainInvokeEvent, command: SetViewBoundsCommand) => {
        this.webViewService.updateViewBounds(command.viewId, command.bounds);
        return { success: true };
      }
    );

    // Set active view (handles visibility automatically)
    this.handle(
      "app:setActiveView",
      async (_event: IpcMainInvokeEvent, command: { viewId: string | null; bounds?: Electron.Rectangle }) => {
        this.webViewService.setActiveView(command.viewId, command.bounds);
        return { success: true };
      }
    );

    // Hide/show active view
    this.handle(
      "app:setViewVisibility",
      async (_event: IpcMainInvokeEvent, command: SetViewVisibilityCommand) => {
        if (command.isHidden) {
          this.webViewService.hideActiveView();
        } else {
          this.webViewService.showActiveView(command.bounds);
        }
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
   * Update view bounds for the active view
   */
  updateActiveViewBounds(bounds: Electron.Rectangle): void {
    const activeViewId = this.stateManager.getActiveViewId();
    if (activeViewId) {
      this.webViewService.updateViewBounds(activeViewId, bounds);
    }
  }
}
