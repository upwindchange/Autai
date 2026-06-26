import { Hono } from "hono";
import { shell } from "electron";
import { z } from "zod";
import { SessionTabService } from "@/services";
import { eventBus } from "@/utils/eventBus";
import log from "electron-log/main";

const logger = log.scope("ApiServer:Shell");
export const shellRoutes = new Hono();

const UrlSchema = z.object({ url: z.string() });
const FilePathSchema = z.object({ filePath: z.string() });

// POST /shell/open-external — http/https routes to internal browser tab, others to external browser
shellRoutes.post("/open-external", async (c) => {
  try {
    const parsed = UrlSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json(
        { error: "Invalid url", details: parsed.error.issues },
        400,
      );
    }
    const { url } = parsed.data;
    if (url.startsWith("http://") || url.startsWith("https://")) {
      const tabId =
        await SessionTabService.getInstance().navigateActiveTabToUrl(url);
      if (tabId) eventBus.emitEvent("splitview:activate", null);
      return c.json({ success: true });
    }
    await shell.openExternal(url);
    return c.json({ success: true });
  } catch (error) {
    logger.error("Error opening external:", error);
    return c.json({ error: "Failed to open" }, 500);
  }
});

// POST /shell/open-system-browser — bypasses internal tab routing
shellRoutes.post("/open-system-browser", async (c) => {
  try {
    const parsed = UrlSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json(
        { error: "Invalid url", details: parsed.error.issues },
        400,
      );
    }
    await shell.openExternal(parsed.data.url);
    return c.json({ success: true });
  } catch (error) {
    logger.error("Error opening in system browser:", error);
    return c.json({ error: "Failed to open" }, 500);
  }
});

// POST /shell/show-in-folder — reveal a file in the system file explorer
shellRoutes.post("/show-in-folder", async (c) => {
  try {
    const parsed = FilePathSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json(
        { error: "Invalid filePath", details: parsed.error.issues },
        400,
      );
    }
    await shell.showItemInFolder(parsed.data.filePath);
    return c.json({ success: true });
  } catch (error) {
    logger.error("Error showing item in folder:", error);
    return c.json({ error: "Failed to reveal file" }, 500);
  }
});
