import { ipcMain, BrowserWindow } from "electron";
import { ViewManager } from "../services";

export function setupViewHandlers(viewManager: ViewManager, win: BrowserWindow) {
  console.log("[ViewHandler] Setting up view handlers");
  
  ipcMain.handle("view:create", async (_, key: string, options) => {
    if (!win) throw new Error("Main window not available");
    return await viewManager.initializeWebView(key, options);
  });

  ipcMain.handle("view:setBounds", async (_, key: string, bounds) => {
    return viewManager.setBounds(key, bounds);
  });

  ipcMain.handle("view:remove", async (_, key: string) => {
    return await viewManager.removeView(key);
  });

  ipcMain.handle("view:getVisible", async () => {
    return viewManager.getVisibleView();
  });

  // Forward active view change events to renderer
  ipcMain.on("active-view-changed", (_, viewKey: string) => {
    win.webContents.send("active-view-changed", viewKey);
  });

  console.log("[ViewHandler] View handlers registered");
}