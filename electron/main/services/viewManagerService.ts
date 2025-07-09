import { BrowserWindow, WebContentsView, ipcMain } from "electron";
import { getHintDetectorScript, getHintClickScript } from "../scripts/hintDetectorLoader";

interface ViewLifecycleInfo {
  key: string;
  createdAt: Date;
  lastAccessedAt: Date;
  url: string;
  isActive: boolean;
}

/**
 * Manages WebContentsViews within the main BrowserWindow.
 * Handles creation, positioning, lifecycle, and cleanup of multiple web views.
 */
export class ViewManager {
  private views = new Map<string, WebContentsView>();
  private visibleView: string | null = null;
  private viewLifecycles = new Map<string, ViewLifecycleInfo>();
  private activeViewKey: string | null = null;
  private cleanupTasks = new Map<string, (() => void | Promise<void>)[]>();
  private eventListeners = new Map<string, { target: any; event: string; listener: any }[]>();
  
  constructor(private win: BrowserWindow) {}

  /**
   * Creates a new WebContentsView with the specified key
   */
  async initializeWebView(key: string, options: any): Promise<string> {
    const existingView = this.views.get(key);
    if (existingView) {
      this.win.contentView.removeChildView(existingView);
      this.views.delete(key);
    }

    const view = new WebContentsView({
      webPreferences: {
        ...options.webPreferences,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    view.setBackgroundColor("#00000000");

    /**
     * Inject Vimium-style hint detection when page loads
     */
    const loadListener = () => {
      console.log(`Page loaded for view: ${key}, injecting hint detection script`);
      const hintDetectorScript = getHintDetectorScript();
      
      view.webContents.executeJavaScript(hintDetectorScript)
        .then(() => {
          console.log(`Successfully injected hint detection script for view: ${key}`);
        })
        .catch(error => {
          console.error(`Failed to inject hint detection script for view: ${key}`, error);
        });
    };
    
    view.webContents.on("did-finish-load", loadListener);
    
    // Track the event listener for cleanup
    this.trackEventListener(key, view.webContents, "did-finish-load", loadListener);

    this.views.set(key, view);
    this.win.contentView.addChildView(view);
    
    // Register view in lifecycle tracking
    this.registerView(key, "");
    
    // Register cleanup task for IPC handler
    this.registerCleanupTask(key, () => {
      ipcMain.removeHandler(`hint:click:${key}`);
    });
    
    return key;
  }

  /**
   * Sets the position and size of a view within the window
   */
  setBounds(key: string, bounds: { x: number; y: number; width: number; height: number }): void {
    const view = this.views.get(key);
    if (!view) throw new Error(`View not found: ${key}`);
    
    if (!bounds || typeof bounds.x !== 'number' || typeof bounds.y !== 'number' || 
        typeof bounds.width !== 'number' || typeof bounds.height !== 'number') {
      throw new Error('Invalid bounds structure');
    }
    
    console.log(`[Main] Setting bounds for view ${key}:`, bounds);
    view.setBounds(bounds);
    
    /**
     * Track which view is currently visible based on bounds
     */
    if (bounds.width > 0 && bounds.height > 0) {
      this.visibleView = key;
      this.setActiveView(key);
    } else if (this.visibleView === key) {
      this.visibleView = null;
    }
  }

  /**
   * Removes a view from the window and cleans up resources
   */
  async removeView(key: string): Promise<void> {
    const view = this.views.get(key);
    if (!view) {
      console.warn(`[Main] Attempted to remove non-existent view: ${key}`);
      return;
    }
    
    console.log(`[Main] Starting removal of view: ${key}`);
    
    try {
      // Remove from window first
      this.win.contentView.removeChildView(view);
      
      // Perform comprehensive cleanup
      await this.cleanupView(key, view);
      
      // Remove from our map
      this.views.delete(key);
      
      // Unregister from lifecycle tracking
      this.unregisterView(key);
      
      console.log(`[Main] Successfully removed view: ${key}`);
    } catch (error) {
      console.error(`[Main] Error removing view ${key}:`, error);
    }
  }

  getView(key: string): WebContentsView {
    const view = this.views.get(key);
    if (!view) throw new Error(`View not found: ${key}`);
    return view;
  }

  async executeHintClick(key: string, index: number): Promise<void> {
    const view = this.views.get(key);
    if (!view) throw new Error(`View not found: ${key}`);
    
    const clickScript = getHintClickScript(index);
    await view.webContents.executeJavaScript(clickScript);
  }

  async detectHints(key: string): Promise<any[]> {
    const view = this.views.get(key);
    if (!view) throw new Error(`View not found: ${key}`);
    
    console.log(`Detecting hints for view: ${key}`);
    try {
      const hints = await view.webContents.executeJavaScript("window.detectHints ? window.detectHints() : []");
      console.log(`Found ${hints?.length || 0} hints for view: ${key}`);
      return hints || [];
    } catch (error) {
      console.error(`Error detecting hints for view: ${key}:`, error);
      return [];
    }
  }

  async showHints(key: string): Promise<void> {
    const view = this.views.get(key);
    if (!view) throw new Error(`View not found: ${key}`);
    
    try {
      await view.webContents.executeJavaScript("window.showHints ? window.showHints() : []");
      console.log(`Showed hints for view: ${key}`);
    } catch (error) {
      console.error(`Error showing hints for view: ${key}:`, error);
    }
  }

  async hideHints(key: string): Promise<void> {
    const view = this.views.get(key);
    if (!view) throw new Error(`View not found: ${key}`);
    
    try {
      await view.webContents.executeJavaScript("window.hideHints ? window.hideHints() : null");
      console.log(`Hid hints for view: ${key}`);
    } catch (error) {
      console.error(`Error hiding hints for view: ${key}:`, error);
    }
  }

  // Get interactable elements for AI agent
  async getInteractableElements(key: string): Promise<any[]> {
    const view = this.views.get(key);
    if (!view) throw new Error(`View not found: ${key}`);
    
    try {
      const elements = await view.webContents.executeJavaScript("window.getInteractableElements ? window.getInteractableElements() : []");
      console.log(`Found ${elements?.length || 0} interactable elements for view: ${key}`);
      return elements || [];
    } catch (error) {
      console.error(`Error getting interactable elements for view: ${key}:`, error);
      return [];
    }
  }

  // Click element by ID for AI agent
  async clickElementById(key: string, elementId: number): Promise<boolean> {
    const view = this.views.get(key);
    if (!view) throw new Error(`View not found: ${key}`);
    
    try {
      const result = await view.webContents.executeJavaScript(`window.clickElementById ? window.clickElementById(${elementId}) : false`);
      console.log(`Clicked element ${elementId} in view: ${key}, result: ${result}`);
      return result;
    } catch (error) {
      console.error(`Error clicking element ${elementId} in view: ${key}:`, error);
      return false;
    }
  }

  // Hide all views
  hideAllViews(): void {
    this.views.forEach((view, key) => {
      view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      console.log(`[Main] Hid view: ${key}`);
    });
  }

  // Show a specific view with its previous bounds
  showView(key: string): void {
    const view = this.views.get(key);
    if (!view) throw new Error(`View not found: ${key}`);
    
    // For now, we'll need the renderer to tell us the bounds
    // In a production app, we'd store previous bounds
    this.visibleView = key;
  }

  // Get currently visible view
  getVisibleView(): string | null {
    return this.visibleView;
  }

  /**
   * Cleanup all views when shutting down
   */
  async destroy(): Promise<void> {
    console.log("[ViewManager] Destroying all views");

    // Remove all views
    const viewKeys = Array.from(this.views.keys());
    for (const key of viewKeys) {
      await this.removeView(key);
    }

    // Final cleanup
    await this.cleanupAll();
  }

  // ViewLifecycleService methods

  /**
   * Register a new view
   */
  private registerView(key: string, url: string) {
    this.viewLifecycles.set(key, {
      key,
      createdAt: new Date(),
      lastAccessedAt: new Date(),
      url,
      isActive: false
    });
    console.log(`[ViewLifecycle] Registered view: ${key} for URL: ${url}`);
  }

  /**
   * Update the active view
   */
  private setActiveView(key: string) {
    // Mark previous active view as inactive
    if (this.activeViewKey && this.viewLifecycles.has(this.activeViewKey)) {
      const prevView = this.viewLifecycles.get(this.activeViewKey)!;
      prevView.isActive = false;
    }

    // Mark new view as active
    if (this.viewLifecycles.has(key)) {
      const view = this.viewLifecycles.get(key)!;
      view.isActive = true;
      view.lastAccessedAt = new Date();
      this.activeViewKey = key;
    }
  }

  /**
   * Unregister a view
   */
  private unregisterView(key: string) {
    const view = this.viewLifecycles.get(key);
    if (view) {
      console.log(`[ViewLifecycle] Unregistering view: ${key}, created at: ${view.createdAt.toISOString()}, lifetime: ${Date.now() - view.createdAt.getTime()}ms`);
      this.viewLifecycles.delete(key);
      
      if (this.activeViewKey === key) {
        this.activeViewKey = null;
      }
    }
  }

  /**
   * Get lifecycle info for a view
   */
  getViewLifecycle(key: string): ViewLifecycleInfo | undefined {
    return this.viewLifecycles.get(key);
  }

  /**
   * Get all views
   */
  getAllViews(): ViewLifecycleInfo[] {
    return Array.from(this.viewLifecycles.values());
  }

  /**
   * Get views that haven't been accessed recently
   */
  getStaleViews(thresholdMinutes: number = 30): ViewLifecycleInfo[] {
    const threshold = Date.now() - (thresholdMinutes * 60 * 1000);
    return this.getAllViews().filter(view => 
      !view.isActive && view.lastAccessedAt.getTime() < threshold
    );
  }

  /**
   * Log current state
   */
  logState() {
    console.log("[ViewLifecycle] Current state:");
    console.log(`  Active view: ${this.activeViewKey}`);
    console.log(`  Total views: ${this.viewLifecycles.size}`);
    
    this.viewLifecycles.forEach(view => {
      console.log(`  - ${view.key}: ${view.url} (active: ${view.isActive}, created: ${view.createdAt.toISOString()})`);
    });
  }

  // CleanupService methods

  /**
   * Register a cleanup task for a specific view
   */
  private registerCleanupTask(viewKey: string, task: () => void | Promise<void>) {
    if (!this.cleanupTasks.has(viewKey)) {
      this.cleanupTasks.set(viewKey, []);
    }
    this.cleanupTasks.get(viewKey)!.push(task);
  }

  /**
   * Track event listeners for cleanup
   */
  private trackEventListener(viewKey: string, target: any, event: string, listener: any) {
    if (!this.eventListeners.has(viewKey)) {
      this.eventListeners.set(viewKey, []);
    }
    this.eventListeners.get(viewKey)!.push({ target, event, listener });
  }

  /**
   * Clean up all resources for a specific view
   */
  private async cleanupView(viewKey: string, view: WebContentsView): Promise<void> {
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
  private async cleanupAll(): Promise<void> {
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