import { ipcMain, IpcMainInvokeEvent } from "electron";
import { NavigationService } from "../services";

/**
 * Sets up IPC handlers for web navigation functionality.
 * Provides browser-like navigation controls for WebContentsViews.
 */
export function setupNavigationHandlers(navigationService: NavigationService) {
  /**
   * Navigate back in the view's history
   */
  ipcMain.handle("nav:back", async (_, key: string) => {
    return navigationService.goBack(key);
  });

  /**
   * Navigate forward in the view's history
   */
  ipcMain.handle("nav:forward", async (_, key: string) => {
    return navigationService.goForward(key);
  });

  /**
   * Check if the view can navigate back
   */
  ipcMain.handle("nav:canGoBack", async (_, key: string) => {
    return navigationService.canGoBack(key);
  });

  /**
   * Check if the view can navigate forward
   */
  ipcMain.handle("nav:canGoForward", async (_, key: string) => {
    return navigationService.canGoForward(key);
  });

  /**
   * Load a URL in the specified view
   */
  ipcMain.handle("nav:loadURL", async (_, key: string, url: string) => {
    return navigationService.loadURL(key, url);
  });

  /**
   * Get the current URL of the view
   */
  ipcMain.handle("nav:getCurrentURL", async (_, key: string) => {
    return navigationService.getCurrentURL(key);
  });

  /**
   * Get the favicon URL of the current page
   */
  ipcMain.handle("nav:getFavicon", async (_, key: string) => {
    return navigationService.getFavicon(key);
  });

  /**
   * Get the title of the current page
   */
  ipcMain.handle("nav:getPageTitle", async (_, key: string) => {
    return navigationService.getPageTitle(key);
  });

  /**
   * Get the navigation history of the view
   */
  ipcMain.handle("nav:getHistory", async (_, key: string) => {
    return navigationService.getHistory(key);
  });
}