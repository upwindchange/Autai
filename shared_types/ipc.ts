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
 * Message types for toast notifications
 */
export type MessageType = 'info' | 'alert' | 'success';

/**
 * Main process message type for IPC communication
 */
export interface AppMessage {
  type: MessageType;
  title: string;
  description: string;
}