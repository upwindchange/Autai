import type { StateManager, WebViewService } from ".";
import type { ActionResult } from "../../shared/types";

/**
 * Service for handling navigation operations and state updates
 * Uses WebViewService directly for navigation operations
 */
export class NavigationService {
  private stateManager: StateManager;
  private webViewService: WebViewService;

  constructor(stateManager: StateManager, webViewService: WebViewService) {
    this.stateManager = stateManager;
    this.webViewService = webViewService;
  }

  /**
   * Navigate to a URL and update page state
   */
  async navigateToUrl(
    taskId: string,
    pageId: string,
    url: string
  ): Promise<ActionResult> {
    try {
      const webView = this.webViewService.requireWebContentsView(
        taskId,
        pageId
      );
      await webView.webContents.loadURL(url);

      // Update page URL and last visited time
      this.stateManager.updatePage(taskId, pageId, {
        url: url,
      });

      return { success: true, data: { url } };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to navigate",
      };
    }
  }

  /**
   * Navigate back in browser history
   */
  async goBack(taskId: string, pageId: string): Promise<ActionResult> {
    try {
      const webView = this.webViewService.requireWebContentsView(
        taskId,
        pageId
      );
      if (webView.webContents.canGoBack()) {
        webView.webContents.goBack();
        return { success: true };
      }
      return { success: false, error: "Cannot go back" };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to go back",
      };
    }
  }

  /**
   * Navigate forward in browser history
   */
  async goForward(taskId: string, pageId: string): Promise<ActionResult> {
    try {
      const webView = this.webViewService.requireWebContentsView(
        taskId,
        pageId
      );
      if (webView.webContents.canGoForward()) {
        webView.webContents.goForward();
        return { success: true };
      }
      return { success: false, error: "Cannot go forward" };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to go forward",
      };
    }
  }

  /**
   * Reload the current page
   */
  async refresh(taskId: string, pageId: string): Promise<ActionResult> {
    try {
      const webView = this.webViewService.requireWebContentsView(
        taskId,
        pageId
      );
      webView.webContents.reload();
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to refresh",
      };
    }
  }

  /**
   * Stop page loading
   */
  async stop(taskId: string, pageId: string): Promise<ActionResult> {
    try {
      const webView = this.webViewService.requireWebContentsView(
        taskId,
        pageId
      );
      webView.webContents.stop();
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to stop loading",
      };
    }
  }
}
