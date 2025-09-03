import { app, BrowserWindow, shell, ipcMain } from "electron";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import { update } from "./update";
import {
  settingsService,
  ThreadViewService,
  ViewControlService,
} from "@backend/services";
import { apiServer } from "@agents";
import { SettingsBridge } from "@backend/bridges/SettingsBridge";
import { ThreadViewBridge } from "@backend/bridges/ThreadViewBridge";

const _require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Built directory structure:
 * dist-electron/
 *   main/index.js      - Electron main process
 *   preload/index.mjs  - Preload scripts
 * dist/index.html      - Electron renderer
 */
process.env.APP_ROOT = path.join(__dirname, "../..");

export const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
export const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");
export const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, "public")
  : RENDERER_DIST;

/**
 * Platform-specific configurations
 */
if (os.release().startsWith("6.1")) app.disableHardwareAcceleration();
if (process.platform === "win32") app.setAppUserModelId(app.getName());

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let win: BrowserWindow | null = null;
let settingsBridge: SettingsBridge | null = null;
let threadViewService: ThreadViewService | null = null;
let _viewControlService: ViewControlService | null = null;
let threadViewBridge: ThreadViewBridge | null = null;
const preload = path.join(__dirname, "../preload/index.mjs");
const indexHtml = path.join(RENDERER_DIST, "index.html");

/**
 * Creates the main application window with security-focused settings
 */
async function createWindow() {
  win = new BrowserWindow({
    title: "Main window",
    icon: path.join(process.env.VITE_PUBLIC, "favicon.ico"),
    webPreferences: {
      preload,
      contextIsolation: false,
      webviewTag: false,
    },
  });

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
    win.webContents.openDevTools();
  } else {
    win.loadFile(indexHtml);
  }

  /**
   * Initialize core services
   */
  // Initialize thread/view service
  threadViewService = new ThreadViewService(win);
  _viewControlService = new ViewControlService(threadViewService);

  // Initialize bridges
  settingsBridge = new SettingsBridge();
  settingsBridge.setupHandlers();

  threadViewBridge = new ThreadViewBridge(threadViewService);
  threadViewBridge.setupHandlers();

  /**
   * Force external links to open in default browser
   */
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https:")) shell.openExternal(url);
    return { action: "deny" };
  });

  update(win);
}

app.whenReady().then(async () => {
  await settingsService.initialize();
  // Start API server
  apiServer.start();
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    console.log("window-all-closed event triggered");
    console.log("Quitting app...");
    app.quit();
  }
});

/**
 * Handle second instance - focus existing window instead of creating new one
 */
app.on("second-instance", () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.on("activate", () => {
  const allWindows = BrowserWindow.getAllWindows();
  if (allWindows.length) {
    allWindows[0].focus();
  } else {
    createWindow();
  }
});

/**
 * Clean up before app quits
 */
let isCleaningUp = false;
app.on("before-quit", async (event) => {
  // Prevent default quit behavior to ensure proper cleanup
  if (isCleaningUp) {
    return; // Already cleaning up, prevent multiple executions
  }

  isCleaningUp = true;
  event.preventDefault();
  console.log("Starting app cleanup...");

  try {
    // Clean up all services and bridges
    if (threadViewService) {
      console.log("Destroying threadViewService...");
      await threadViewService.destroy();
      threadViewService = null;
      console.log("threadViewService destroyed");
    }

    if (threadViewBridge) {
      console.log("Destroying threadViewBridge...");
      threadViewBridge.destroy();
      threadViewBridge = null;
      console.log("threadViewBridge destroyed");
    }

    if (settingsBridge) {
      console.log("Destroying settingsBridge...");
      settingsBridge.destroy();
      settingsBridge = null;
      console.log("settingsBridge destroyed");
    }

    _viewControlService = null;

    // Stop API server
    console.log("Stopping API server...");
    apiServer.stop();
    console.log("API server stopped");

    // Force cleanup of any remaining web contents
    console.log("Cleaning up remaining windows...");
    const allWindows = BrowserWindow.getAllWindows();
    for (const window of allWindows) {
      try {
        if (!window.isDestroyed()) {
          console.log("Destroying window...");
          window.destroy();
          console.log("Window destroyed");
        }
      } catch (error) {
        console.warn("Error cleaning up window:", error);
      }
    }

    console.log("App cleanup completed");
  } catch (error) {
    console.error("Error during cleanup:", error);
  } finally {
    // Ensure the app quits even if there are errors
    console.log("Ensuring app quit...");
    setTimeout(() => {
      app.exit(0); // Use app.exit instead of app.quit to bypass Electron's quit handling
    }, 50);
  }
});

/**
 * Handler for opening new child windows
 */
ipcMain.handle("open-win", (_, arg) => {
  const childWindow = new BrowserWindow({
    webPreferences: {
      preload,
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  if (VITE_DEV_SERVER_URL) {
    childWindow.loadURL(`${VITE_DEV_SERVER_URL}#${arg}`);
  } else {
    childWindow.loadFile(indexHtml, { hash: arg });
  }
});
