import { BrowserWindow, WebContentsView } from "electron";
import { getHintDetectorScript } from "../scripts/hintDetectorLoader";

/**
 * Manages WebContentsViews within the main BrowserWindow.
 * Handles creation, positioning, and cleanup of multiple web views.
 */
export class ViewManager {
  private views = new Map<string, WebContentsView>();
  private visibleView: string | null = null;
  
  constructor(private win: BrowserWindow) {}

  /**
   * Creates a new WebContentsView with the specified key
   */
  async initializeWebView(key: string, options: any): Promise<string> {
    // Clean up existing view if present
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
    
    // Forward console messages from WebContentsView to main process
    view.webContents.on('console-message', (event, level, message, line, sourceId) => {
      const logPrefix = `[WebView:${key}]`;
      const logMessage = `${logPrefix} ${message}`;
      
      // Map numeric levels to console methods
      switch (level) {
        case 0: // Verbose
          console.log(logMessage);
          break;
        case 1: // Info
          console.log(logMessage);
          break;
        case 2: // Warning
          console.warn(logMessage);
          break;
        case 3: // Error
          console.error(logMessage);
          break;
        default:
          console.log(logMessage);
      }
      
      // Also log source information in development
      if (process.env.NODE_ENV !== 'production' && sourceId) {
        console.log(`  └─ ${sourceId}:${line}`);
      }
    });
    
    // Inject hint detector script when page loads for AI agent interaction
    view.webContents.on("did-finish-load", () => {
      const hintDetectorScript = getHintDetectorScript();
      view.webContents.executeJavaScript(hintDetectorScript)
        .then(() => {
          console.log(`Injected hint detector script for AI agent in view: ${key}`);
        })
        .catch(error => {
          console.error(`Failed to inject hint detector script for view: ${key}`, error);
        });
    });
    
    this.views.set(key, view);
    this.win.contentView.addChildView(view);
    
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
    
    // Track which view is currently visible based on bounds
    if (bounds.width > 0 && bounds.height > 0) {
      this.visibleView = key;
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
      // Remove from window
      this.win.contentView.removeChildView(view);
      
      // Clean up WebContents
      if (view.webContents && !view.webContents.isDestroyed()) {
        view.webContents.stop();
        view.webContents.removeAllListeners();
        view.webContents.close();
      }
      
      // Remove from our map
      this.views.delete(key);
      
      // Clear visible view if it was this one
      if (this.visibleView === key) {
        this.visibleView = null;
      }
      
      console.log(`[Main] Successfully removed view: ${key}`);
    } catch (error) {
      console.error(`[Main] Error removing view ${key}:`, error);
    }
  }

  /**
   * Get a view by key
   */
  getView(key: string): WebContentsView {
    const view = this.views.get(key);
    if (!view) throw new Error(`View not found: ${key}`);
    return view;
  }

  /**
   * Get currently visible view
   */
  getVisibleView(): string | null {
    return this.visibleView;
  }

  /**
   * Get interactable elements for AI agent
   * @param key - The view key
   * @param viewportOnly - Whether to only detect elements in viewport (default: true)
   */
  async getInteractableElements(key: string, viewportOnly: boolean = true): Promise<any[]> {
    const view = this.views.get(key);
    if (!view) throw new Error(`View not found: ${key}`);
    
    try {
      const elements = await view.webContents.executeJavaScript(
        `window.getInteractableElements ? window.getInteractableElements(${viewportOnly}) : []`
      );
      console.log(`Found ${elements?.length || 0} interactable elements (viewport: ${viewportOnly}) for view: ${key}`);
      return elements || [];
    } catch (error) {
      console.error(`Error getting interactable elements for view: ${key}:`, error);
      return [];
    }
  }

  /**
   * Click element by ID for AI agent
   * @param key - The view key
   * @param elementId - The element ID to click
   * @param viewportOnly - Whether the element ID is from viewport-only detection (default: true)
   */
  async clickElementById(key: string, elementId: number, viewportOnly: boolean = true): Promise<boolean> {
    const view = this.views.get(key);
    if (!view) throw new Error(`View not found: ${key}`);
    
    try {
      const result = await view.webContents.executeJavaScript(
        `window.clickElementById ? window.clickElementById(${elementId}, ${viewportOnly}) : false`
      );
      console.log(`Clicked element ${elementId} (viewport: ${viewportOnly}) in view: ${key}, result: ${result}`);
      return result;
    } catch (error) {
      console.error(`Error clicking element ${elementId} in view: ${key}:`, error);
      return false;
    }
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
  }
}