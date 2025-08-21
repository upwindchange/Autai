import type { ViewId } from "@shared/index";
import { ThreadViewService } from "@backend/services";

export class ViewControlService {
  private threadViewService: ThreadViewService; // We'll inject this dependency

  constructor(threadViewService: ThreadViewService) {
    this.threadViewService = threadViewService;
  }

  /**
   * Navigates a view to a URL
   */
  async navigateTo(viewId: ViewId, url: string): Promise<void> {
    const view = this.threadViewService.getView(viewId);
    if (!view) {
      throw new Error(`View ${viewId} not found`);
    }

    await view.webContents.loadURL(url);
  }

  /**
   * Refreshes the current page
   */
  async refresh(viewId: ViewId): Promise<void> {
    const view = this.threadViewService.getView(viewId);
    if (!view) {
      throw new Error(`View ${viewId} not found`);
    }

    view.webContents.reload();
  }

  /**
   * Goes back in navigation history
   */
  async goBack(viewId: ViewId): Promise<boolean> {
    const view = this.threadViewService.getView(viewId);
    if (!view) {
      return false;
    }

    if (view.webContents.navigationHistory.canGoBack()) {
      view.webContents.navigationHistory.goBack();
      return true;
    }

    return false;
  }

  /**
   * Goes forward in navigation history
   */
  async goForward(viewId: ViewId): Promise<boolean> {
    const view = this.threadViewService.getView(viewId);
    if (!view) {
      return false;
    }

    if (view.webContents.navigationHistory.canGoForward()) {
      view.webContents.navigationHistory.goForward();
      return true;
    }

    return false;
  }
}
