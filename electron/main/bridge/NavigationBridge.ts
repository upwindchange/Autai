import { IpcMainInvokeEvent, BrowserWindow } from "electron";
import { BaseBridge } from "./BaseBridge";
import type {
  NavigateCommand,
  NavigationControlCommand,
} from "../../shared/types/index";
import { BrowserActionService, StateManager } from "../services";

/**
 * Handles navigation-related IPC operations
 */
export class NavigationBridge extends BaseBridge {
  private browserActionService: BrowserActionService;

  constructor(stateManager: StateManager, win: BrowserWindow) {
    super(stateManager, win);
    this.browserActionService = new BrowserActionService(stateManager);
  }
  setupHandlers(): void {
    // Navigate to URL
    this.handle(
      "app:navigate",
      async (_event: IpcMainInvokeEvent, command: NavigateCommand) => {
        const result = await this.browserActionService.navigateTo(
          command.taskId,
          command.pageId,
          command.url
        );

        if (result.success) {
          // Update page URL
          this.stateManager.updatePage(command.taskId, command.pageId, {
            url: command.url,
            lastVisited: Date.now(),
          });
        }

        return result;
      }
    );

    // Navigation controls
    this.handle(
      "app:navigationControl",
      async (_event: IpcMainInvokeEvent, command: NavigationControlCommand) => {
        switch (command.action) {
          case "back":
            return await this.browserActionService.goBack(
              command.taskId,
              command.pageId
            );
          case "forward":
            return await this.browserActionService.goForward(
              command.taskId,
              command.pageId
            );
          case "reload":
            return await this.browserActionService.refresh(
              command.taskId,
              command.pageId
            );
          case "stop": {
            // Find the view by taskId and pageId
            const view = this.stateManager.getViewForPage(
              command.taskId,
              command.pageId
            );
            if (view) {
              const webView = this.stateManager.getWebContentsView(view.id);
              if (webView) {
                webView.webContents.stop();
                return { success: true };
              }
            }
            return { success: false, error: "View not found" };
          }
          default:
            return { success: false, error: "Invalid action" };
        }
      }
    );
  }
}
