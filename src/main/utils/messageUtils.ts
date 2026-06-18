import type { AppMessage } from "@shared";
import { eventBus } from "@/utils/eventBus";

/**
 * Sends an app message to renderer clients via the event bus (forwarded over
 * the GET /events SSE stream). This utility can be used anywhere in the main
 * process.
 */
export function sendAppMessage(message: AppMessage): void {
  eventBus.emitEvent("app:message", message);
}

/**
 * Helper function to send an alert message
 */
export function sendAlert(title: string, description: string): void {
  sendAppMessage({
    type: "alert",
    title,
    description,
  });
}

/**
 * Helper function to send an info message
 */
export function sendInfo(title: string, description: string): void {
  sendAppMessage({
    type: "info",
    title,
    description,
  });
}

/**
 * Helper function to send a success message
 */
export function sendSuccess(title: string, description: string): void {
  sendAppMessage({
    type: "success",
    title,
    description,
  });
}
