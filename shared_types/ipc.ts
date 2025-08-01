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