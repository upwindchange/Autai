import { BrowserWindow } from "electron";
import { StateManager } from "../services";
import { TaskBridge } from "./TaskBridge";
import { ViewBridge } from "./ViewBridge";
import { NavigationBridge } from "./NavigationBridge";
import { SettingsBridge } from "./SettingsBridge";
import { AgentBridge } from "./AgentBridge";
import type { StateChangeEvent } from "../../shared/types/index";

/**
 * Bridges IPC communication between main and renderer processes.
 * Handles all state-related commands and synchronization.
 */
export class StateBridge {
  private stateManager: StateManager;
  private win: BrowserWindow;
  private unsubscribe: (() => void) | null = null;

  // Bridge instances
  private taskBridge: TaskBridge;
  private viewBridge: ViewBridge;
  private navigationBridge: NavigationBridge;
  private settingsBridge: SettingsBridge;
  private agentBridge: AgentBridge;

  constructor(stateManager: StateManager, win: BrowserWindow) {
    this.stateManager = stateManager;
    this.win = win;

    // Initialize bridges
    this.taskBridge = new TaskBridge(stateManager, win);
    this.viewBridge = new ViewBridge(stateManager, win);
    this.navigationBridge = new NavigationBridge(stateManager, win);
    this.settingsBridge = new SettingsBridge(stateManager, win);
    this.agentBridge = new AgentBridge(stateManager, win);

    this.setupHandlers();
    this.setupStateSync();
  }

  private setupHandlers(): void {
    // Setup handlers for all bridges
    this.taskBridge.setupHandlers();
    this.viewBridge.setupHandlers();
    this.navigationBridge.setupHandlers();
    this.settingsBridge.setupHandlers();
    this.agentBridge.setupHandlers();
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
    setInterval(() => {
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

    // Clean up all bridges
    this.taskBridge.destroy();
    this.viewBridge.destroy();
    this.navigationBridge.destroy();
    this.settingsBridge.destroy();
    this.agentBridge.cleanup(); // Also calls agentManagerService.cleanup()
    this.agentBridge.destroy();
  }
}
