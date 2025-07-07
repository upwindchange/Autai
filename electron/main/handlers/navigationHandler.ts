import { ipcMain, IpcMainInvokeEvent } from "electron";
import { NavigationService } from "../services/navigationService";

export function setupNavigationHandlers(navigationService: NavigationService) {
  ipcMain.handle("nav:back", async (_, key: string) => {
    return navigationService.goBack(key);
  });

  ipcMain.handle("nav:forward", async (_, key: string) => {
    return navigationService.goForward(key);
  });

  ipcMain.handle("nav:canGoBack", async (_, key: string) => {
    return navigationService.canGoBack(key);
  });

  ipcMain.handle("nav:canGoForward", async (_, key: string) => {
    return navigationService.canGoForward(key);
  });

  ipcMain.handle("nav:loadURL", async (_, key: string, url: string) => {
    return navigationService.loadURL(key, url);
  });

  ipcMain.handle("nav:getCurrentURL", async (_, key: string) => {
    return navigationService.getCurrentURL(key);
  });

  ipcMain.handle("nav:getFavicon", async (_, key: string) => {
    return navigationService.getFavicon(key);
  });

  ipcMain.handle("nav:getPageTitle", async (_, key: string) => {
    return navigationService.getPageTitle(key);
  });

  ipcMain.handle("nav:getHistory", async (_, key: string) => {
    return navigationService.getHistory(key);
  });
}