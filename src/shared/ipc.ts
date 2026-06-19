/**
 * Toast notification message types used by the SSE "app:message" push event.
 */

/**
 * Message types for toast notifications
 */
export type MessageType = "info" | "alert" | "success";

/**
 * Main process message type for IPC communication
 */
export interface AppMessage {
  type: MessageType;
  title: string;
  description: string;
}
