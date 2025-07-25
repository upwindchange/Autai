import { BrowserWindow } from "electron";
import { StateManager, type WebViewService, type AuiBrowserViewService } from "../services";
import { ViewBridge } from "./ViewBridge";
import { SettingsBridge } from "./SettingsBridge";
import { AuiThreadBridge } from "./AuiThreadBridge";
import type { 
  StateChangeEvent, 
  IAuiThreadViewManager 
} from "../../shared/types";

/**
 * Bridges IPC communication between main and renderer processes.
 * Handles all state-related commands and synchronization.
 */
export class StateBridge {
  private stateManager: StateManager;
  private win: BrowserWindow;
  private unsubscribe: (() => void) | null = null;
  private syncIntervalId: NodeJS.Timeout | null = null;

  // Bridge instances
  private viewBridge: ViewBridge;
  private settingsBridge: SettingsBridge;
  private auiThreadBridge: AuiThreadBridge;

  constructor(
    stateManager: StateManager,
    webViewService: WebViewService,
    win: BrowserWindow,
    browserViewService: AuiBrowserViewService,
    auiThreadViewManager: IAuiThreadViewManager
  ) {
    this.stateManager = stateManager;
    this.win = win;

    // Initialize bridges
    this.viewBridge = new ViewBridge(stateManager, webViewService);
    this.settingsBridge = new SettingsBridge();
    this.auiThreadBridge = new AuiThreadBridge(browserViewService, auiThreadViewManager);

    this.setupHandlers();
    this.setupStateSync();
  }

  private setupHandlers(): void {
    // Setup handlers for all bridges
    this.viewBridge.setupHandlers();
    this.settingsBridge.setupHandlers();
    this.auiThreadBridge.setupHandlers();
  }

  private setupStateSync(): void {
    // Subscribe to state changes and forward to renderer
    this.unsubscribe = this.stateManager.subscribe(
      (event: StateChangeEvent) => {
        if (!this.win.isDestroyed() && this.win.webContents) {
          this.win.webContents.send("state:change", event);
        }
      }
    );

    // Send full state sync periodically (as backup)
    this.syncIntervalId = setInterval(() => {
      if (!this.win.isDestroyed() && this.win.webContents) {
        this.win.webContents.send(
          "state:sync",
          this.stateManager.getFullState()
        );
      }
    }, 5000);
  }

  /**
   * Update view bounds for all views based on container bounds
   */
  updateViewBounds(containerBounds: Electron.Rectangle): void {
    this.viewBridge.updateViewBounds(containerBounds);
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }

    // Clear the sync interval to prevent memory leak
    if (this.syncIntervalId) {
      clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
    }

    // Clean up all bridges
    this.viewBridge.destroy();
    this.settingsBridge.destroy();
    this.auiThreadBridge.destroy();
  }
}
