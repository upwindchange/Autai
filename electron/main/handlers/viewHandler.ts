import { ipcMain, IpcMainInvokeEvent, BrowserWindow } from "electron";
import { ViewManager } from "../services/viewManagerService";

export function setupViewHandlers(viewManager: ViewManager, win: BrowserWindow) {
  ipcMain.handle("view:create", async (_, key: string, options) => {
    if (!win) throw new Error("Main window not available");
    return viewManager.createView(key, options);
  });

  ipcMain.handle("view:setBounds", async (_, key: string, bounds) => {
    return viewManager.setBounds(key, bounds);
  });

  ipcMain.handle("view:remove", async (_, key: string) => {
    return viewManager.removeView(key);
  });

  // Register dynamic hint click handlers for each view
  const originalCreateView = viewManager.createView.bind(viewManager);
  viewManager.createView = async function(key: string, options: any) {
    const result = await originalCreateView(key, options);
    
    // Register hint click handler for this specific view
    ipcMain.handle(`hint:click:${key}`, async (_, index: number) => {
      return viewManager.executeHintClick(key, index);
    });
    
    return result;
  };

  // Forward active view change events to renderer
  ipcMain.on("active-view-changed", (_, viewKey: string) => {
    win.webContents.send("active-view-changed", viewKey);
  });
}