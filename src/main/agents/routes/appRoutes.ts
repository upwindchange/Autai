import { Hono } from "hono";
import { app, nativeTheme } from "electron";
import { z } from "zod";
import log from "electron-log/main";

const logger = log.scope("ApiServer:App");
export const appRoutes = new Hono();

const ThemeSchema = z.object({
  theme: z.enum(["system", "light", "dark"]),
});

// POST /app/version
appRoutes.post("/version", (c) => {
  return c.json({ version: app.getVersion() });
});

// POST /app/system-info
appRoutes.post("/system-info", (c) => {
  return c.json({
    platform: process.platform,
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
    chromeVersion: process.versions.chrome,
    v8Version: process.versions.v8,
  });
});

// POST /app/theme — fire-and-forget native theme sync
appRoutes.post("/theme", async (c) => {
  try {
    const parsed = ThemeSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "Invalid theme", details: parsed.error.issues }, 400);
    }
    nativeTheme.themeSource = parsed.data.theme;
    return c.json({ success: true });
  } catch (error) {
    logger.error("Error syncing theme:", error);
    return c.json({ error: "Failed to sync theme" }, 500);
  }
});
