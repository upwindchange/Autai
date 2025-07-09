import { ipcMain, IpcMainInvokeEvent } from "electron";
import { ViewManager } from "../services/viewManagerService";

export function setupHintHandlers(viewManager: ViewManager) {
  ipcMain.handle("hints:detect", async (_, key: string) => {
    return viewManager.detectHints(key);
  });

  ipcMain.handle("hints:show", async (_, key: string) => {
    return viewManager.showHints(key);
  });

  ipcMain.handle("hints:hide", async (_, key: string) => {
    return viewManager.hideHints(key);
  });
}