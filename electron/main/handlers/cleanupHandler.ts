import { ipcMain, app } from "electron";
import { viewLifecycleService } from "../services/viewLifecycleService";

/**
 * Sets up IPC handlers for cleanup and monitoring functionality
 */
export function setupCleanupHandlers() {
  /**
   * Get lifecycle information for all views
   */
  ipcMain.handle("cleanup:getViewLifecycles", async () => {
    return viewLifecycleService.getAllViews();
  });

  /**
   * Get stale views that haven't been accessed recently
   */
  ipcMain.handle("cleanup:getStaleViews", async (_, thresholdMinutes?: number) => {
    return viewLifecycleService.getStaleViews(thresholdMinutes);
  });

  /**
   * Log current state of all views
   */
  ipcMain.handle("cleanup:logState", async () => {
    viewLifecycleService.logState();
    return { success: true };
  });

  /**
   * Force garbage collection (if exposed)
   */
  ipcMain.handle("cleanup:forceGC", async () => {
    if (global.gc) {
      global.gc();
      console.log("[CleanupHandler] Forced garbage collection");
      return { success: true, message: "Garbage collection triggered" };
    } else {
      console.log("[CleanupHandler] Garbage collection not available");
      return { success: false, message: "Garbage collection not exposed" };
    }
  });

  console.log("[CleanupHandler] Cleanup handlers registered");
}