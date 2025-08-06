import { app, BrowserWindow, shell, ipcMain } from "electron";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import { update } from "./update";
import {
  settingsService,
  apiServer,
  ThreadViewService,
  ViewControlService,
} from "./services";
import { SettingsBridge } from "./bridge/SettingsBridge";
import { ThreadViewBridge } from "./bridge/ThreadViewBridge";
import { ViewDebugBridge } from "./bridge/ViewDebugBridge";

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
let viewControlService: ViewControlService | null = null;
let viewControlBridge: ViewDebugBridge | null = null;
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
      contextIsolation: true,
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
  viewControlService = new ViewControlService(threadViewService);
  
  // Initialize bridges
  settingsBridge = new SettingsBridge();
  settingsBridge.setupHandlers();
  
  threadViewBridge = new ThreadViewBridge(threadViewService);
  threadViewBridge.setupHandlers();
  
  viewControlBridge = new ViewDebugBridge(viewControlService, threadViewService);
  viewControlBridge.setupHandlers();

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

app.on("window-all-closed", async () => {
  // Clean up all services and bridges before quitting
  if (threadViewService) {
    await threadViewService.destroy();
    threadViewService = null;
  }
  if (threadViewBridge) {
    threadViewBridge.destroy();
    threadViewBridge = null;
  }
  if (viewControlBridge) {
    viewControlBridge.destroy();
    viewControlBridge = null;
  }
  if (settingsBridge) {
    settingsBridge.destroy();
    settingsBridge = null;
  }
  viewControlService = null;
  // Stop API server
  apiServer.stop();
  win = null;
  if (process.platform !== "darwin") app.quit();
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
app.on("before-quit", async (event) => {
  if (settingsBridge || threadViewBridge || threadViewService || viewControlService || viewControlBridge) {
    event.preventDefault();
    if (threadViewService) {
      await threadViewService.destroy();
      threadViewService = null;
    }
    if (threadViewBridge) {
      threadViewBridge.destroy();
      threadViewBridge = null;
    }
    if (viewControlBridge) {
      viewControlBridge.destroy();
      viewControlBridge = null;
    }
    if (settingsBridge) {
      settingsBridge.destroy();
      settingsBridge = null;
    }
    viewControlService = null;
    app.quit();
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
