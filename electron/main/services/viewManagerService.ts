import { BrowserWindow, WebContentsView, ipcMain } from "electron";
import { getHintDetectorScript, getHintClickScript } from "../scripts/hintDetectorLoader";
import { cleanupService } from "./cleanupService";
import { viewLifecycleService } from "./viewLifecycleService";

/**
 * Manages WebContentsViews within the main BrowserWindow.
 * Handles creation, positioning, and lifecycle of multiple web views.
 */
export class ViewManager {
  private views = new Map<string, WebContentsView>();
  private visibleView: string | null = null;
  
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
    cleanupService.trackEventListener(key, view.webContents, "did-finish-load", loadListener);

    this.views.set(key, view);
    this.win.contentView.addChildView(view);
    
    // Register view in lifecycle service
    viewLifecycleService.registerView(key, "");
    
    // Register cleanup task for IPC handler
    cleanupService.registerCleanupTask(key, () => {
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
      viewLifecycleService.setActiveView(key);
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
      await cleanupService.cleanupView(key, view);
      
      // Remove from our map
      this.views.delete(key);
      
      // Unregister from lifecycle service
      viewLifecycleService.unregisterView(key);
      
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
    await cleanupService.cleanupAll();
  }
}