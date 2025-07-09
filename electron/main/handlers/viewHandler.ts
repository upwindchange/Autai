import { ipcMain, IpcMainInvokeEvent, BrowserWindow } from "electron";
import { ViewManager } from "../services/viewManagerService";

// Helper function to register hint handlers for a view
function registerHintHandlersForView(viewManager: ViewManager, key: string) {
  // Register hint click handler for this specific view
  // Note: The cleanup of this handler is now managed by cleanupService
  ipcMain.handle(`hint:click:${key}`, async (_, index: number) => {
    return viewManager.executeHintClick(key, index);
  });
}

export function setupViewHandlers(viewManager: ViewManager, win: BrowserWindow) {
  // Log when handlers are set up
  console.log("[ViewHandler] Setting up view handlers");
  
  ipcMain.handle("view:create", async (_, key: string, options) => {
    if (!win) throw new Error("Main window not available");
    const result = await viewManager.initializeWebView(key, options);
    registerHintHandlersForView(viewManager, key);
    return result;
  });

  ipcMain.handle("view:setBounds", async (_, key: string, bounds) => {
    return viewManager.setBounds(key, bounds);
  });

  ipcMain.handle("view:remove", async (_, key: string) => {
    return await viewManager.removeView(key);
  });

  // Forward active view change events to renderer
  ipcMain.on("active-view-changed", (_, viewKey: string) => {
    win.webContents.send("active-view-changed", viewKey);
  });

  // Hide all views (for dialogs/overlays)
  ipcMain.handle("view:hideAll", async () => {
    return viewManager.hideAllViews();
  });

  // Show a specific view
  ipcMain.handle("view:show", async (_, key: string) => {
    return viewManager.showView(key);
  });

  // Get currently visible view
  ipcMain.handle("view:getVisible", async () => {
    return viewManager.getVisibleView();
  });

  // Cleanup handlers (previously in cleanupHandler.ts)
  
  /**
   * Get lifecycle information for all views
   */
  ipcMain.handle("cleanup:getViewLifecycles", async () => {
    return viewManager.getAllViews();
  });

  /**
   * Get stale views that haven't been accessed recently
   */
  ipcMain.handle("cleanup:getStaleViews", async (_, thresholdMinutes?: number) => {
    return viewManager.getStaleViews(thresholdMinutes);
  });

  /**
   * Log current state of all views
   */
  ipcMain.handle("cleanup:logState", async () => {
    viewManager.logState();
    return { success: true };
  });

  /**
   * Force garbage collection (if exposed)
   */
  ipcMain.handle("cleanup:forceGC", async () => {
    if (global.gc) {
      global.gc();
      console.log("[ViewHandler] Forced garbage collection");
      return { success: true, message: "Garbage collection triggered" };
    } else {
      console.log("[ViewHandler] Garbage collection not available");
      return { success: false, message: "Garbage collection not exposed" };
    }
  });

  console.log("[ViewHandler] View and cleanup handlers registered");
}