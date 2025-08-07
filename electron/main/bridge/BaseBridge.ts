import { ipcMain, IpcMainInvokeEvent, IpcMainEvent } from "electron";

/**
 * Base class for all IPC bridge implementations.
 * Provides common functionality and patterns for handling IPC communication.
 */
export abstract class BaseBridge {
  protected handlers: Map<string, string> = new Map();
  protected onHandlers: Map<string, string> = new Map();

  /**
   * Setup IPC handlers. Must be implemented by subclasses.
   */
  abstract setupHandlers(): void;

  /**
   * Register an IPC handler with error handling
   */
  protected handle<TCommand = unknown, TResult = unknown>(
    channel: string,
    handler: (event: IpcMainInvokeEvent, command: TCommand) => Promise<TResult> | TResult
  ): void {
    this.handlers.set(channel, channel);

    ipcMain.handle(
      channel,
      async (event: IpcMainInvokeEvent, command: TCommand) => {
        try {
          return await handler(event, command);
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
   * Register an IPC handler for send operations (no return value)
   */
  protected on<TCommand = unknown>(
    channel: string,
    handler: (event: IpcMainEvent, command: TCommand) => Promise<void> | void
  ): void {
    this.onHandlers.set(channel, channel);

    ipcMain.on(
      channel,
      async (event: IpcMainEvent, command: TCommand) => {
        try {
          await handler(event, command);
        } catch (error) {
          console.error(`Error in ${channel}:`, error);
        }
      }
    );
  }

  /**
   * Clean up all registered handlers
   */
  destroy(): void {
    this.handlers.forEach((_, channel) => {
      ipcMain.removeHandler(channel);
    });
    this.handlers.clear();
    
    this.onHandlers.forEach((_, channel) => {
      ipcMain.removeAllListeners(channel);
    });
    this.onHandlers.clear();
  }
}
