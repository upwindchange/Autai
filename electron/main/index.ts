import { app, BrowserWindow, WebContentsView, shell, ipcMain } from "electron";
import { agentService } from "./agent";
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
const views = new Map<string, WebContentsView>(); // Store views by composite key (taskIndex + pageIndex)
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

  ipcMain.handle("view:create", async (_, key: string, options) => {
    if (!win) throw new Error("Main window not available");

    // Remove existing view if any
    const existingView = views.get(key);
    if (existingView) {
      win.contentView.removeChildView(existingView);
      views.delete(key);
    }

    const view = new WebContentsView({
      webPreferences: {
        ...options.webPreferences,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    view.setBackgroundColor("#00000000");

    views.set(key, view);
    win.contentView.addChildView(view);
    return key;
  });

  ipcMain.handle("view:setBounds", async (_, key, bounds) => {
    const view = views.get(key);
    if (!view) throw new Error(`View not found: ${key}`);
    
    // Validate bounds structure
    if (!bounds || typeof bounds !== 'object' ||
        typeof bounds.x !== 'number' ||
        typeof bounds.y !== 'number' ||
        typeof bounds.width !== 'number' ||
        typeof bounds.height !== 'number') {
      throw new TypeError(`Invalid bounds format: ${JSON.stringify(bounds)}`);
    }
    
    view.setBounds(bounds);
  });

  ipcMain.handle("view:remove", async (_, key) => {
    const view = views.get(key);
    if (!view) throw new Error(`View not found: ${key}`);
    if (win) win.contentView.removeChildView(view);
    views.delete(key);
    console.log(`[Main] Removed view: ${key}`);
  });

  ipcMain.handle("nav:back", async (_, key) => {
    const view = views.get(key);
    if (!view) throw new Error(`View not found: ${key}`);
    return view.webContents.navigationHistory.goBack();
  });

  ipcMain.handle("nav:forward", async (_, key) => {
    const view = views.get(key);
    if (!view) throw new Error(`View not found: ${key}`);
    return view.webContents.navigationHistory.goForward();
  });

  ipcMain.handle("nav:canGoBack", async (_, key) => {
    const view = views.get(key);
    if (!view) throw new Error(`View not found: ${key}`);
    return view.webContents.navigationHistory.canGoBack();
  });

  ipcMain.handle("nav:canGoForward", async (_, key) => {
    const view = views.get(key);
    if (!view) throw new Error(`View not found: ${key}`);
    return view.webContents.navigationHistory.canGoForward();
  });

  ipcMain.handle("nav:loadURL", async (_, key, url) => {
    const view = views.get(key);
    if (!view) throw new Error(`View not found: ${key}`);

    try {
      await view.webContents.loadURL(url);
      await waitForReadyState(view, "complete");
      const html = await view.webContents.executeJavaScript(
        "document.documentElement.outerHTML"
      );
      return html;
    } catch (error) {
      console.error("Failed to load URL or get HTML:", error);
      throw error;
    }
  });

  async function waitForReadyState(view: WebContentsView, targetState: string) {
    while (true) {
      try {
        const readyState = await view.webContents.executeJavaScript(
          "document.readyState"
        );
        if (readyState === targetState) {
          break;
        }
      } catch (error) {
        console.error("Error checking readyState:", error);
      }
      await new Promise((resolve) => setTimeout(resolve, 100)); // wait 100ms
    }
  }

  ipcMain.handle("nav:getCurrentURL", async (_, key) => {
    const view = views.get(key);
    if (!view) throw new Error(`View not found: ${key}`);
    return view.webContents.getURL();
  });

  ipcMain.handle("nav:getFavicon", async (_, key) => {
    const view = views.get(key);
    if (!view) throw new Error(`View not found: ${key}`);
    
    try {
      const favicon = await view.webContents.executeJavaScript(`
        document.querySelector('link[rel="icon"]')?.href ||
        document.querySelector('link[rel="shortcut icon"]')?.href ||
        ''
      `);
      return favicon;
    } catch (error) {
      console.error("Error getting favicon:", error);
      return "";
    }
  });

  ipcMain.handle("nav:getPageTitle", async (_, key) => {
    const view = views.get(key);
    if (!view) throw new Error(`View not found: ${key}`);
    return view.webContents.getTitle();
  });

  ipcMain.handle("nav:getHistory", async (_, key) => {
    const view = views.get(key);
    if (!view) throw new Error(`View not found: ${key}`);
    return view.webContents.navigationHistory.getAllEntries();
  });

  // Make all links open with the browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https:")) shell.openExternal(url);
    return { action: "deny" };
  });

  // Auto update
  update(win);

  // Add new handler for GenAI messages
  ipcMain.handle("genai:send", async (_, message: string) => {
    return agentService.processMessage(message);
  });
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
