import { BrowserWindow } from "electron";
import type { AppMessage } from "@shared/index";

/**
 * Sends an app message to the renderer process
 * This utility can be used anywhere in the main process
 */
export function sendAppMessage(message: AppMessage): void {
  try {
    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("app:message", message);
    }
  } catch (error) {
    console.error("Failed to send app message:", error);
  }
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