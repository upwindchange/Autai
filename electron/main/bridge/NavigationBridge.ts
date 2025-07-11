import { IpcMainInvokeEvent } from "electron";
import { BaseBridge } from "./BaseBridge";
import type { NavigateCommand } from "../../shared/types";

/**
 * Handles navigation-related IPC operations
 */
export class NavigationBridge extends BaseBridge {
  setupHandlers(): void {
    // Navigate to URL
    this.handle(
      "app:navigate",
      async (_event: IpcMainInvokeEvent, command: NavigateCommand) => {
        const views = Array.from(this.stateManager.getFullState().views);
        const view = views.find(([_, v]) => v.pageId === command.pageId)?.[1];

        if (view) {
          const webView = this.stateManager.getWebContentsView(view.id);
          if (webView) {
            await webView.webContents.loadURL(command.url);

            // Update page URL
            this.stateManager.updatePage(view.taskId, command.pageId, {
              url: command.url,
              lastVisited: Date.now(),
            });
          }
        }
        return { success: true };
      }
    );

    // Navigation controls
    this.handle(
      "app:goBack",
      async (_event: IpcMainInvokeEvent, viewId: string) => {
        const webView = this.stateManager.getWebContentsView(viewId);
        if (webView && webView.webContents.canGoBack()) {
          webView.webContents.goBack();
          return { success: true };
        }
        return { success: false, error: "Cannot go back" };
      }
    );

    this.handle(
      "app:goForward",
      async (_event: IpcMainInvokeEvent, viewId: string) => {
        const webView = this.stateManager.getWebContentsView(viewId);
        if (webView && webView.webContents.canGoForward()) {
          webView.webContents.goForward();
          return { success: true };
        }
        return { success: false, error: "Cannot go forward" };
      }
    );

    this.handle(
      "app:reload",
      async (_event: IpcMainInvokeEvent, viewId: string) => {
        const webView = this.stateManager.getWebContentsView(viewId);
        if (webView) {
          webView.webContents.reload();
          return { success: true };
        }
        return { success: false, error: "View not found" };
      }
    );

    this.handle(
      "app:stop",
      async (_event: IpcMainInvokeEvent, viewId: string) => {
        const webView = this.stateManager.getWebContentsView(viewId);
        if (webView) {
          webView.webContents.stop();
          return { success: true };
        }
        return { success: false, error: "View not found" };
      }
    );
  }
}
