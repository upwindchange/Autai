import { BrowserWindow, WebContentsView, ipcMain } from "electron";
import { getHintDetectorScript, getHintClickScript } from "./scripts/hintDetectorLoader";

export class ViewManager {
  private views = new Map<string, WebContentsView>();
  
  constructor(private win: BrowserWindow) {}

  async createView(key: string, options: any): Promise<string> {
    // Remove existing view if any
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

    // Inject hint detection script when page loads
    view.webContents.on("did-finish-load", () => {
      console.log(`Page loaded for view: ${key}, injecting hint detection script`);
      const hintDetectorScript = getHintDetectorScript();
      
      view.webContents.executeJavaScript(hintDetectorScript)
        .then(() => {
          console.log(`Successfully injected hint detection script for view: ${key}`);
        })
        .catch(error => {
          console.error(`Failed to inject hint detection script for view: ${key}`, error);
        });
    });

    this.views.set(key, view);
    this.win.contentView.addChildView(view);
    return key;
  }

  setBounds(key: string, bounds: { x: number; y: number; width: number; height: number }): void {
    const view = this.views.get(key);
    if (!view) throw new Error(`View not found: ${key}`);
    
    // Validate bounds structure
    if (!bounds || typeof bounds !== 'object' ||
        typeof bounds.x !== 'number' ||
        typeof bounds.y !== 'number' ||
        typeof bounds.width !== 'number' ||
        typeof bounds.height !== 'number') {
      throw new TypeError(`Invalid bounds format: ${JSON.stringify(bounds)}`);
    }
    
    view.setBounds(bounds);
  }

  removeView(key: string): void {
    const view = this.views.get(key);
    if (!view) {
      console.warn(`[Main] View not found during removal: ${key}`);
      return;
    }
    this.win.contentView.removeChildView(view);
    this.views.delete(key);
    console.log(`[Main] Removed view: ${key}`);
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
}