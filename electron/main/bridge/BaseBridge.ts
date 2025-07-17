import { ipcMain, IpcMainInvokeEvent } from "electron";

/**
 * Base class for all IPC bridge implementations.
 * Provides common functionality and patterns for handling IPC communication.
 */
export abstract class BaseBridge {
  protected handlers: Map<string, string> = new Map();

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
   * Clean up all registered handlers
   */
  destroy(): void {
    this.handlers.forEach((_, channel) => {
      ipcMain.removeHandler(channel);
    });
    this.handlers.clear();
  }
}
