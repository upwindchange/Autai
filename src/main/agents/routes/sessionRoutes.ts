import { Hono } from "hono";
import type { Rectangle } from "electron";
import { z } from "zod";
import { SessionTabService } from "@/services";
import log from "electron-log/main";

const logger = log.scope("ApiServer:Sessions");
export const sessionRoutes = new Hono();

const RectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

const SessionIdSchema = z.object({ sessionId: z.string() });
const ContainerRectSchema = z.object({ rect: z.union([RectSchema, z.null()]) });

// POST /sessions/activate — ensure session exists and make it active (fire-and-forget)
sessionRoutes.post("/activate", async (c) => {
  try {
    const parsed = SessionIdSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "Invalid sessionId" }, 400);
    }
    await SessionTabService.getInstance().activateSession(parsed.data.sessionId);
    return c.json({ success: true });
  } catch (error) {
    logger.error("Error activating session:", error);
    return c.json({ error: "Failed to activate session" }, 500);
  }
});

// DELETE /sessions/:id — delete a session and all its tabs (fire-and-forget)
sessionRoutes.delete("/:id", async (c) => {
  try {
    await SessionTabService.getInstance().deleteSession(c.req.param("id"));
    return c.json({ success: true });
  } catch (error) {
    logger.error("Error deleting session:", error);
    return c.json({ error: "Failed to delete session" }, 500);
  }
});

// POST /sessions/container-rect — set split-view container bounds (fire-and-forget)
sessionRoutes.post("/container-rect", async (c) => {
  try {
    const parsed = ContainerRectSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "Invalid rect" }, 400);
    }
    await SessionTabService.getInstance().setContainerRect(
      parsed.data.rect as Rectangle | null,
    );
    return c.json({ success: true });
  } catch (error) {
    logger.error("Error setting container rect:", error);
    return c.json({ error: "Failed to set container rect" }, 500);
  }
});

// POST /sessions/active-tab — query the active tab id for a session
sessionRoutes.post("/active-tab", async (c) => {
  try {
    const parsed = SessionIdSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "Invalid sessionId" }, 400);
    }
    const data = SessionTabService.getInstance().getActiveTabForSession(
      parsed.data.sessionId,
    );
    return c.json({ success: true, data });
  } catch (error) {
    logger.error("Error getting active tab:", error);
    return c.json({ error: "Failed to get active tab" }, 500);
  }
});
