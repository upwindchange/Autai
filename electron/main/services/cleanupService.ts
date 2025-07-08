import { WebContentsView, ipcMain } from "electron";

/**
 * Manages cleanup of WebContentsView and associated resources
 */
export class CleanupService {
  private cleanupTasks = new Map<string, (() => void | Promise<void>)[]>();
  private eventListeners = new Map<string, { target: any; event: string; listener: any }[]>();

  /**
   * Register a cleanup task for a specific view
   */
  registerCleanupTask(viewKey: string, task: () => void | Promise<void>) {
    if (!this.cleanupTasks.has(viewKey)) {
      this.cleanupTasks.set(viewKey, []);
    }
    this.cleanupTasks.get(viewKey)!.push(task);
  }

  /**
   * Track event listeners for cleanup
   */
  trackEventListener(viewKey: string, target: any, event: string, listener: any) {
    if (!this.eventListeners.has(viewKey)) {
      this.eventListeners.set(viewKey, []);
    }
    this.eventListeners.get(viewKey)!.push({ target, event, listener });
  }

  /**
   * Clean up all resources for a specific view
   */
  async cleanupView(viewKey: string, view: WebContentsView): Promise<void> {
    console.log(`[CleanupService] Starting cleanup for view: ${viewKey}`);

    try {
      // 1. Remove all event listeners
      const listeners = this.eventListeners.get(viewKey) || [];
      for (const { target, event, listener } of listeners) {
        if (target && typeof target.removeListener === 'function') {
          target.removeListener(event, listener);
        } else if (target && typeof target.off === 'function') {
          target.off(event, listener);
        }
      }
      this.eventListeners.delete(viewKey);

      // 2. Execute all registered cleanup tasks
      const tasks = this.cleanupTasks.get(viewKey) || [];
      for (const task of tasks) {
        try {
          await task();
        } catch (error) {
          console.error(`[CleanupService] Error executing cleanup task for ${viewKey}:`, error);
        }
      }
      this.cleanupTasks.delete(viewKey);

      // 3. Clean up WebContents
      if (view && view.webContents && !view.webContents.isDestroyed()) {
        try {
          // Stop all navigation
          view.webContents.stop();
          
          // Clear session data
          await view.webContents.session.clearCache();
          
          // Remove all listeners
          view.webContents.removeAllListeners();
          
          // Force close the webContents to terminate the renderer process
          view.webContents.close();
          
          // Forcefully terminate the renderer process if it still exists
          if (view.webContents.getOSProcessId && !view.webContents.isDestroyed()) {
            const pid = view.webContents.getOSProcessId();
            if (pid) {
              console.log(`[CleanupService] Force terminating process ${pid} for view: ${viewKey}`);
              try {
                process.kill(pid, 'SIGKILL');
              } catch (killError) {
                console.error(`[CleanupService] Error killing process ${pid}:`, killError);
              }
            }
          }
          
          console.log(`[CleanupService] WebContents closed for view: ${viewKey}`);
        } catch (error) {
          console.error(`[CleanupService] Error closing WebContents for ${viewKey}:`, error);
        }
      }

      // 4. Unregister IPC handlers
      this.unregisterIpcHandlers(viewKey);

      console.log(`[CleanupService] Cleanup completed for view: ${viewKey}`);
    } catch (error) {
      console.error(`[CleanupService] Critical error during cleanup for ${viewKey}:`, error);
    }
  }

  /**
   * Unregister all IPC handlers for a view
   */
  private unregisterIpcHandlers(viewKey: string) {
    try {
      // Remove hint click handler
      ipcMain.removeHandler(`hint:click:${viewKey}`);
      console.log(`[CleanupService] Unregistered IPC handlers for view: ${viewKey}`);
    } catch (error) {
      console.error(`[CleanupService] Error unregistering IPC handlers for ${viewKey}:`, error);
    }
  }

  /**
   * Clean up all tracked resources
   */
  async cleanupAll(): Promise<void> {
    console.log("[CleanupService] Cleaning up all resources");
    
    const allKeys = Array.from(this.cleanupTasks.keys());
    for (const key of allKeys) {
      // Note: We don't have the view reference here, so we just clean up what we can
      await this.cleanupView(key, null as any);
    }

    this.cleanupTasks.clear();
    this.eventListeners.clear();
  }
}

export const cleanupService = new CleanupService();