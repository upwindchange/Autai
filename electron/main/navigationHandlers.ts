import { WebContentsView } from "electron";
import { ViewManager } from "./viewManager";

export class NavigationHandlers {
  constructor(private viewManager: ViewManager) {}

  async goBack(key: string): Promise<void> {
    const view = this.viewManager.getView(key);
    return view.webContents.navigationHistory.goBack();
  }

  async goForward(key: string): Promise<void> {
    const view = this.viewManager.getView(key);
    return view.webContents.navigationHistory.goForward();
  }

  async canGoBack(key: string): Promise<boolean> {
    const view = this.viewManager.getView(key);
    return view.webContents.navigationHistory.canGoBack();
  }

  async canGoForward(key: string): Promise<boolean> {
    const view = this.viewManager.getView(key);
    return view.webContents.navigationHistory.canGoForward();
  }

  async loadURL(key: string, url: string): Promise<{ title: string; favicon: string }> {
    const view = this.viewManager.getView(key);

    try {
      await view.webContents.loadURL(url);
      await this.waitForReadyState(view, "complete");

      // Get page metadata after load completes
      const title = view.webContents.getTitle();
      const favicon = await view.webContents.executeJavaScript(`
        document.querySelector('link[rel="icon"]')?.href ||
        document.querySelector('link[rel="shortcut icon"]')?.href ||
        ''
      `);
      return { title, favicon };
    } catch (error) {
      console.error("Failed to load URL or get HTML:", error);
      throw error;
    }
  }

  async getCurrentURL(key: string): Promise<string> {
    const view = this.viewManager.getView(key);
    return view.webContents.getURL();
  }

  async getFavicon(key: string): Promise<string> {
    const view = this.viewManager.getView(key);
    
    try {
      const favicon = await view.webContents.executeJavaScript(`
        document.querySelector('link[rel="icon"]')?.href ||
        document.querySelector('link[rel="shortcut icon"]')?.href ||
        ''
      `);
      return favicon;
    } catch (error) {
      console.error("Error getting favicon:", error);
      return "";
    }
  }

  async getPageTitle(key: string): Promise<string> {
    const view = this.viewManager.getView(key);
    return view.webContents.getTitle();
  }

  async getHistory(key: string): Promise<any[]> {
    const view = this.viewManager.getView(key);
    return view.webContents.navigationHistory.getAllEntries();
  }

  private async waitForReadyState(view: WebContentsView, targetState: string): Promise<void> {
    while (true) {
      try {
        const readyState = await view.webContents.executeJavaScript("document.readyState");
        if (readyState === targetState) {
          break;
        }
      } catch (error) {
        console.error("Error checking readyState:", error);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}