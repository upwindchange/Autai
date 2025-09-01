/**
 * IPC-related type definitions
 */

/**
 * Minimal IpcRendererEvent interface to avoid importing Electron types in renderer
 */
export interface IpcRendererEvent {
  sender: {
    send: (channel: string, ...args: unknown[]) => void;
  };
  senderId: number;
}

/**
 * Main process error type for IPC communication
 */
export interface MainProcessError {
  type: "uncaughtException" | "unhandledRejection";
  message: string;
  stack?: string;
  timestamp: string;
}