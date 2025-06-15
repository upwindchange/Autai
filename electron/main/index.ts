import { app, BrowserWindow, WebContentsView, shell, ipcMain } from "electron";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import { update } from "./update";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The built directory structure
//
// ├─┬ dist-electron
// │ ├─┬ main
// │ │ └── index.js    > Electron-Main
// │ └─┬ preload
// │   └── index.mjs   > Preload-Scripts
// ├─┬ dist
// │ └── index.html    > Electron-Renderer
//
process.env.APP_ROOT = path.join(__dirname, "../..");

export const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
export const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");
export const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, "public")
  : RENDERER_DIST;

// Disable GPU Acceleration for Windows 7
if (os.release().startsWith("6.1")) app.disableHardwareAcceleration();

// Set application name for Windows 10+ notifications
if (process.platform === "win32") app.setAppUserModelId(app.getName());

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let win: BrowserWindow | null = null;
const views = new Map<number, WebContentsView>(); // Store views by ID
const preload = path.join(__dirname, "../preload/index.mjs");
const indexHtml = path.join(RENDERER_DIST, "index.html");

async function createWindow() {
  win = new BrowserWindow({
    title: "Main window",
    icon: path.join(process.env.VITE_PUBLIC, "favicon.ico"),
    webPreferences: {
      preload,
      // Warning: Enable nodeIntegration and disable contextIsolation is not secure in production
      // nodeIntegration: true,

      // Consider using contextBridge.exposeInMainWorld
      // Read more on https://www.electronjs.org/docs/latest/tutorial/context-isolation
      // contextIsolation: false,
      // Enable context isolation for security
      contextIsolation: true,
      // Disable webview tag support
      webviewTag: false,
    },
  });

  if (VITE_DEV_SERVER_URL) {
    // #298
    win.loadURL(VITE_DEV_SERVER_URL);
    // Open devTool if the app is not packaged
    win.webContents.openDevTools();
  } else {
    win.loadFile(indexHtml);
  }

  ipcMain.handle("view:create", async (_, options) => {
    if (!win) throw new Error("Main window not available");

    const view = new WebContentsView({
      webPreferences: {
        ...options.webPreferences,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    view.setBackgroundColor("#00000000");

    const viewId = Date.now(); // Unique ID
    views.set(viewId, view);
    win.contentView.addChildView(view);
    return viewId;
  });

  ipcMain.handle("view:setBounds", async (_, viewId, bounds) => {
    const view = views.get(viewId);
    if (!view) throw new Error(`View not found: ${viewId}`);
    view.setBounds(bounds);
  });

  ipcMain.handle("view:remove", async (_, viewId) => {
    const view = views.get(viewId);
    if (!view) throw new Error(`View not found: ${viewId}`);
    if (win) win.contentView.removeChildView(view);
    views.delete(viewId);
    console.log(`[Main] Removed view ID: ${viewId}`);
  });

  ipcMain.handle("nav:back", async (_, viewId) => {
    const view = views.get(viewId);
    if (!view) throw new Error(`View not found: ${viewId}`);
    return view.webContents.navigationHistory.goBack();
  });

  ipcMain.handle("nav:forward", async (_, viewId) => {
    const view = views.get(viewId);
    if (!view) throw new Error(`View not found: ${viewId}`);
    return view.webContents.navigationHistory.goForward();
  });

  ipcMain.handle("nav:canGoBack", async (_, viewId) => {
    const view = views.get(viewId);
    if (!view) throw new Error(`View not found: ${viewId}`);
    return view.webContents.navigationHistory.canGoBack();
  });

  ipcMain.handle("nav:canGoForward", async (_, viewId) => {
    const view = views.get(viewId);
    if (!view) throw new Error(`View not found: ${viewId}`);
    return view.webContents.navigationHistory.canGoForward();
  });

  ipcMain.handle("nav:loadURL", async (_, viewId, url) => {
    const view = views.get(viewId);
    if (!view) throw new Error(`View not found: ${viewId}`);
    return view.webContents.loadURL(url);
  });

  ipcMain.handle("nav:getCurrentURL", async (_, viewId) => {
    const view = views.get(viewId);
    if (!view) throw new Error(`View not found: ${viewId}`);
    return view.webContents.getURL();
  });

  ipcMain.handle("nav:getHistory", async (_, viewId) => {
    const view = views.get(viewId);
    if (!view) throw new Error(`View not found: ${viewId}`);
    return view.webContents.navigationHistory.getAllEntries();
  });

  // Make all links open with the browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https:")) shell.openExternal(url);
    return { action: "deny" };
  });

  // Auto update
  update(win);
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  win = null;
  if (process.platform !== "darwin") app.quit();
});

app.on("second-instance", () => {
  if (win) {
    // Focus on the main window if the user tried to open another
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

// New window example arg: new windows url
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
