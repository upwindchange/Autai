import { Hono } from "hono";
import {
  settingsService,
  threadPersistenceService,
  threadIntelligenceService,
} from "@/services";
import { i18n, resolveLanguage } from "@/i18n";
import {
  SettingsStateSchema,
  TestConnectionConfigSchema,
} from "../schemas/apiSchemas";
import log from "electron-log/main";
import type { SettingsState, TestConnectionConfig, LogLevel } from "@shared";
import { getSqlite } from "@/db";

const logger = log.scope("ApiServer:Settings");
export const settingsRoutes = new Hono();

// GET /settings
settingsRoutes.get("/", (c) => {
  try {
    return c.json(settingsService.settings);
  } catch (error) {
    logger.error("Error loading settings:", error);
    return c.json({ error: "Failed to load settings" }, 500);
  }
});

// PUT /settings
settingsRoutes.put("/", async (c) => {
  try {
    const body = await c.req.json();
    const parsed = SettingsStateSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "Invalid settings", details: parsed.error.issues },
        400,
      );
    }
    const settings = parsed.data as SettingsState;
    settingsService.saveSettings(settings);

    if (settings.language) {
      i18n.changeLanguage(resolveLanguage(settings.language));
    }

    if (settings.logLevel) {
      log.transports.file.level = settings.logLevel as LogLevel;
      log.transports.console.level = settings.logLevel as LogLevel;
      log.transports.ipc.level = settings.logLevel as LogLevel;
    }

    return c.json({ success: true });
  } catch (error) {
    logger.error("Error saving settings:", error);
    return c.json({ error: "Failed to save settings" }, 500);
  }
});

// GET /settings/configured
settingsRoutes.get("/configured", (c) => {
  try {
    return c.json({ configured: settingsService.isConfigured() });
  } catch (error) {
    logger.error("Error checking configuration:", error);
    return c.json({ error: "Failed to check configuration" }, 500);
  }
});

// POST /settings/test
settingsRoutes.post("/test", async (c) => {
  try {
    const body = await c.req.json();
    const parsed = TestConnectionConfigSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "Invalid connection config", details: parsed.error.issues },
        400,
      );
    }
    await settingsService.testConnection(parsed.data as TestConnectionConfig);
    return c.json({ success: true });
  } catch (error) {
    logger.error("Error testing connection:", error);
    return c.json({ error: "Failed to test connection" }, 500);
  }
});

// GET /settings/log-path
settingsRoutes.get("/log-path", (c) => {
  try {
    const file = log.transports.file.getFile();
    return c.json({ path: file?.path || "" });
  } catch (error) {
    logger.error("Error getting log path:", error);
    return c.json({ error: "Failed to get log path" }, 500);
  }
});

// POST /settings/clear-logs
settingsRoutes.post("/clear-logs", (c) => {
  try {
    const file = log.transports.file.getFile();
    if (file) {
      file.clear();
      logger.info("Log file cleared");
    }
    return c.json({ success: true });
  } catch (error) {
    logger.error("Error clearing logs:", error);
    return c.json({ error: "Failed to clear logs" }, 500);
  }
});

// POST /settings/open-log-folder
settingsRoutes.post("/open-log-folder", async (c) => {
  try {
    const { shell } = await import("electron");
    const file = log.transports.file.getFile();
    if (file?.path) {
      const path = await import("path");
      const logDir = path.dirname(file.path);
      await shell.openPath(logDir);
    }
    return c.json({ success: true });
  } catch (error) {
    logger.error("Error opening log folder:", error);
    return c.json({ error: "Failed to open log folder" }, 500);
  }
});

// POST /settings/open-devtools
settingsRoutes.post("/open-devtools", async (c) => {
  try {
    const { BrowserWindow } = await import("electron");
    const win = BrowserWindow.getFocusedWindow();
    if (win) {
      win.webContents.openDevTools();
    }
    return c.json({ success: true });
  } catch (error) {
    logger.error("Error opening DevTools:", error);
    return c.json({ error: "Failed to open DevTools" }, 500);
  }
});

// POST /settings/purge-thread-tables
settingsRoutes.post("/purge-thread-tables", (c) => {
  try {
    threadPersistenceService.purgeThreadTables();
    threadIntelligenceService.initialize();
    logger.info("Thread tables purged and recreated");
    return c.json({ success: true });
  } catch (error) {
    logger.error("Error purging thread tables:", error);
    return c.json({ error: "Failed to purge thread tables" }, 500);
  }
});

// POST /settings/purge-settings-tables
settingsRoutes.post("/purge-settings-tables", (c) => {
  try {
    const sqlite = getSqlite();
    sqlite.exec(`
      DROP TABLE IF EXISTS model_assignments;
      DROP TABLE IF EXISTS user_providers;
      DROP TABLE IF EXISTS settings;
    `);
    settingsService.initialize();
    logger.info("Settings tables purged and reloaded");
    return c.json({ success: true });
  } catch (error) {
    logger.error("Error purging settings tables:", error);
    return c.json({ error: "Failed to purge settings tables" }, 500);
  }
});
