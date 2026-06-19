import { app, BrowserWindow, Menu, shell } from "electron";
// import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import log from "electron-log/main";
import type { LogLevel } from "@shared";
import { update } from "./update";
import { buildApplicationMenu } from "./menu";
import {
  HitlService,
  settingsService,
  SessionTabService,
  TabControlService,
  threadPersistenceService,
  threadIntelligenceService,
} from "@/services";
import { PQueueManager } from "@agents/utils";
import { apiServer } from "@agents";
import { initializeTelemetry, shutdownTelemetry } from "@agents/utils";
import * as registry from "@agents/providers/registry";
import { eventBus } from "@/utils/eventBus";
import { searchService } from "@/services/searchService";
import { initializeDatabase, closeDatabase } from "@/db";
import { initI18n, i18n } from "@/i18n";

// const _require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Create scoped logger for main process
const logger = log.scope("main");

/**
 * Built directory structure:
 * out/
 *   main/index.js      - Electron main process
 *   preload/index.mjs  - Preload scripts
 *   renderer/index.html - Electron renderer
 */
process.env.APP_ROOT = path.join(__dirname, "../..");

export const RENDERER_DIST = path.join(process.env.APP_ROOT, "out/renderer");
const ELECTRON_RENDERER_URL = process.env.ELECTRON_RENDERER_URL;

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
let currentApiPort = 0;
let sessionTabService: SessionTabService | null = null;
const preload = path.join(__dirname, "../preload/index.mjs");
const indexHtml = path.join(RENDERER_DIST, "index.html");
const resourcesBase =
  import.meta.env.DEV ?
    path.join(process.env.APP_ROOT!, "resources")
  : path.join(process.resourcesPath, "resources");
const splashHtml = path.join(resourcesBase, "splash.html");

const appIcon =
  import.meta.env.DEV ?
    path.join(
      process.env.APP_ROOT!,
      "build",
      process.platform === "win32" ? "icon.ico"
      : process.platform === "darwin" ? "icon.icns"
      : "icon.png",
    )
  : undefined;

/**
 * Creates the main application window with security-focused settings
 */
async function createWindow(splash?: BrowserWindow) {
  win = new BrowserWindow({
    title: i18n.t("common.mainWindowTitle"),
    autoHideMenuBar: false,
    show: false,
    icon: appIcon,
    webPreferences: {
      preload,
      contextIsolation: true,
      sandbox: false, // preload is now a no-op; enabling sandbox:true is a tracked follow-up
      webviewTag: false,
    },
  });

  // Native application menu: default menus (File/Edit/View/Window/Help) plus a
  // custom "Option" menu. See src/main/menu.ts.
  Menu.setApplicationMenu(buildApplicationMenu(win));

  // Disable default keyboard shortcuts for zoom
  // win.webContents.on("before-input-event", (event, input) => {
  //   if (input.control && ["+", "-", "="].includes(input.key)) {
  //     event.preventDefault();
  //   }
  //   if (input.control && input.key === "0") {
  //     event.preventDefault();
  //   }
  // });

  /**
   * Initialize core services BEFORE loading renderer to avoid IPC race conditions
   */
  // Initialize SessionTabService singleton
  sessionTabService = SessionTabService.getInstance(win);

  // Initialize ViewControlService singleton
  TabControlService.getInstance(sessionTabService);

  // Initialize PQueueManager for all agent operations
  PQueueManager.getInstance({
    concurrency: 3,
    timeout: 30000,
    autoStart: true,
  });

  /**
   * Route link clicks to internal browser tab instead of external browser
   */

  // Intercept regular <a> clicks (without target="_blank")
  win.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      event.preventDefault();
      sessionTabService!
        .navigateActiveTabToUrl(url)
        .then((tabId) => {
          if (tabId && win && !win.isDestroyed()) {
            eventBus.emitEvent("splitview:activate", null);
          }
        })
        .catch((err) =>
          logger.warn("will-navigate: failed to route internally", {
            url,
            err,
          }),
        );
    }
  });

  // Intercept target="_blank" and window.open()
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      sessionTabService!
        .navigateActiveTabToUrl(url)
        .then((tabId) => {
          if (tabId && win && !win.isDestroyed()) {
            eventBus.emitEvent("splitview:activate", null);
          }
        })
        .catch((err) =>
          logger.warn("setWindowOpenHandler: failed to route internally", {
            url,
            err,
          }),
        );
    } else if (
      url.startsWith("mailto:") ||
      url.startsWith("tel:") ||
      url.startsWith("sms:")
    ) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  // Load renderer AFTER services and handlers are fully initialized. The API
  // port is passed via the URL query string (no IPC): the renderer reads
  // ?apiPort= to build its base URL. A remote browser (served by the backend)
  // gets no param and uses same-origin relative URLs instead.
  if (import.meta.env.DEV) {
    win.loadURL(`${ELECTRON_RENDERER_URL!}?apiPort=${currentApiPort}`);
  } else {
    win.loadFile(indexHtml, { query: { apiPort: String(currentApiPort) } });
  }

  win.webContents.on("did-finish-load", () => {
    splash?.close();
    win?.show();
    // Role-based menu items (zoom, reload, devtools, …) act on the focused
    // webContents and are disabled while none has focus. At startup the main
    // window's page isn't focused, so they stay disabled until the user clicks
    // into the renderer. win.focus() activates the native window but doesn't
    // reliably focus the webContents page on Windows — webContents.focus() is
    // what makes the page the focused webContents, so the roles work at startup.
    win?.focus();
    win?.webContents?.focus();
  });

  update();
}

app.whenReady().then(async () => {
  // Show splash screen immediately — wait for it to paint before doing any work
  const splash = new BrowserWindow({
    width: 400,
    height: 240,
    frame: false,
    transparent: true,
    resizable: false,
    center: true,
    icon: appIcon,
  });
  splash.loadFile(splashHtml);
  await new Promise<void>((resolve) =>
    splash.webContents.on("did-finish-load", () => resolve()),
  );

  const updateSplashStatus = (text: string) => {
    splash.webContents.executeJavaScript(
      `document.getElementById('status').textContent = '${text.replace(/'/g, "\\'")}'`,
    );
  };

  // Initialize electron-log
  log.initialize();

  // Configure log file path
  const userDataPath = app.getPath("userData");
  const logPath = path.join(userDataPath, "logs");

  log.transports.file.resolvePathFn = () => {
    const date = new Date().toISOString().split("T")[0];
    const filename = app.isPackaged ? `main-${date}.log` : "main.log";
    return path.join(logPath, filename);
  };

  // Catch errors
  log.errorHandler.startCatching({
    showDialog: false,
    onError: (error) => {
      log.error("Uncaught error:", error);
    },
  });

  // Initialize database (single connection, runs Drizzle migrations)
  updateSplashStatus("Initializing database...");
  initializeDatabase();

  // Initialize services that use the database
  searchService.initialize();
  threadPersistenceService.initialize();

  // Load settings from database
  settingsService.initialize();

  // Initialize i18n with saved language
  initI18n(settingsService.settings.language || "en");

  // Initialize provider registry (reads TOML files)
  const providersPath = path.join(resourcesBase, "providers");
  registry.initialize(providersPath);

  // Initialize thread intelligence (seeds default tags if first launch)
  threadIntelligenceService.initialize();

  // Set log levels from settings or use defaults
  const logLevel =
    settingsService.settings.logLevel || (app.isPackaged ? "info" : "debug");
  // electron-log accepts string literals for log levels
  log.transports.file.level = logLevel as LogLevel;
  log.transports.console.level = logLevel as LogLevel;
  log.transports.ipc.level = logLevel as LogLevel;

  logger.info("Application starting", { version: app.getVersion() });

  // Initialize telemetry (must be done after settings are loaded)
  initializeTelemetry();

  // Start API server — host/port come from the connection settings. Standalone
  // always binds 127.0.0.1 on a random port; Remote Access binds the configured
  // host/port (default 0.0.0.0) so browsers on the network can reach it.
  updateSplashStatus("Starting API server...");
  const connCfg = settingsService.settings;
  const isRemote = connCfg.serverMode === "remote";
  const host = isRemote ? connCfg.serverHost.trim() || "0.0.0.0" : "127.0.0.1";
  const port = isRemote ? connCfg.serverPort || 8787 : 0;
  currentApiPort = await apiServer.start({
    host,
    port,
    staticRoot: RENDERER_DIST,
  });
  logger.info(
    `API server running on http://${host}:${currentApiPort} (${connCfg.serverMode})`,
  );

  // Start window
  updateSplashStatus("Loading interface...");
  createWindow(splash);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    logger.info("window-all-closed event triggered");
    logger.info("Quitting app...");
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
  logger.info("Starting app cleanup...");

  try {
    // Clean up all services
    if (sessionTabService) {
      logger.debug("Destroying sessionTabService...");
      await sessionTabService.destroy();
      sessionTabService = null;
      logger.debug("sessionTabService destroyed");
    }

    // Reject any pending HITL requests
    HitlService.getInstance().rejectAll("Application shutting down");

    // Clean up ViewControlService singleton
    TabControlService.destroyInstance();

    // Close database connection
    closeDatabase();

    // Stop API server
    logger.info("Stopping API server...");
    apiServer.stop();
    logger.info("API server stopped");

    // Shutdown PQueueManager
    logger.info("Shutting down PQueueManager...");
    await PQueueManager.getInstance().shutdown();
    logger.info("PQueueManager shutdown complete");

    // Shutdown telemetry
    logger.info("Shutting down telemetry...");
    await shutdownTelemetry();
    logger.info("Telemetry shutdown complete");

    // Force cleanup of any remaining web contents
    logger.debug("Cleaning up remaining windows...");
    const allWindows = BrowserWindow.getAllWindows();
    for (const window of allWindows) {
      try {
        if (!window.isDestroyed()) {
          logger.debug("Destroying window...");
          window.destroy();
          logger.debug("Window destroyed");
        }
      } catch (error) {
        logger.warn("Error cleaning up window:", error);
      }
    }

    logger.info("App cleanup completed");
  } catch (error) {
    logger.error("Error during cleanup:", error);
  } finally {
    // Ensure the app quits even if there are errors
    logger.info("Ensuring app quit...");
    setTimeout(() => {
      app.exit(0); // Use app.exit instead of app.quit to bypass Electron's quit handling
    }, 50);
  }
});
