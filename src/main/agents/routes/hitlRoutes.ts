import { Hono } from "hono";
import { z } from "zod";
import { HitlService } from "@/services";
import log from "electron-log/main";

const logger = log.scope("ApiServer:Hitl");
export const hitlRoutes = new Hono();

const RespondSchema = z.object({
  id: z.string(),
  response: z.unknown(),
});

// POST /hitl/respond — submit a user response that resolves a pending HITL request
hitlRoutes.post("/respond", async (c) => {
  try {
    const parsed = RespondSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "Invalid response payload" }, 400);
    }
    HitlService.getInstance().respond(parsed.data.id, parsed.data.response);
    return c.json({ success: true });
  } catch (error) {
    logger.error("Error responding to HITL:", error);
    return c.json({ error: "Failed to respond" }, 500);
  }
});
