import { ipcMain, BrowserWindow, IpcMainInvokeEvent } from "electron";
import { StateManager } from "../services/StateManager";

/**
 * Base class for all IPC bridge implementations.
 * Provides common functionality and patterns for handling IPC communication.
 */
export abstract class BaseBridge {
  protected stateManager: StateManager;
  protected win: BrowserWindow;
  protected handlers: Map<string, string> = new Map();

  constructor(stateManager: StateManager, win: BrowserWindow) {
    this.stateManager = stateManager;
    this.win = win;
  }

  /**
   * Setup IPC handlers. Must be implemented by subclasses.
   */
  abstract setupHandlers(): void;

  /**
   * Register an IPC handler with error handling
   */
  protected handle<T = any, R = any>(
    channel: string,
    handler: (event: IpcMainInvokeEvent, ...args: any[]) => Promise<R> | R
  ): void {
    this.handlers.set(channel, channel);

    ipcMain.handle(
      channel,
      async (event: IpcMainInvokeEvent, ...args: any[]) => {
        try {
          return await handler(event, ...args);
        } catch (error) {
          console.error(`Error in ${channel}:`, error);
          return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          };
        }
      }
    );
  }

  /**
   * Send a message to the renderer process
   */
  protected send(channel: string, ...args: any[]): void {
    if (!this.win.isDestroyed() && this.win.webContents) {
      this.win.webContents.send(channel, ...args);
    }
  }

  /**
   * Clean up all registered handlers
   */
  destroy(): void {
    this.handlers.forEach((_, channel) => {
      ipcMain.removeHandler(channel);
    });
    this.handlers.clear();
  }
}
