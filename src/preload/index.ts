import { contextBridge } from "electron";
import { electronAPI } from "@electron-toolkit/preload";

// Define window extensions for TypeScript
interface ExtendedWindow extends Window {
  ipcRenderer?: typeof electronAPI.ipcRenderer;
  electron?: typeof electronAPI;
}

/**
 * Expose secure IPC communication methods to the renderer process.
 * Using @electron-toolkit/preload to simplify the implementation.
 * This requires sandbox: false in BrowserWindow configuration.
 */
if (process.contextIsolated) {
  try {
    // Expose the electron API with a custom name to match existing code
    contextBridge.exposeInMainWorld("ipcRenderer", electronAPI.ipcRenderer);
    // Also expose the full electron API for additional functionality
    contextBridge.exposeInMainWorld("electron", electronAPI);
  } catch (error) {
    console.error("Failed to expose APIs:", error);
  }
} else {
  // Cast window to ExtendedWindow to add our custom properties
  const extWindow = window as ExtendedWindow;
  extWindow.ipcRenderer = electronAPI.ipcRenderer;
  extWindow.electron = electronAPI;
}
