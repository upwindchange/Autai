import { Hono } from "hono";
import { threadPersistenceService } from "@/services";
import { CreateThreadSchema, UpdateThreadSchema } from "../schemas/apiSchemas";
import log from "electron-log/main";

const logger = log.scope("ApiServer:Threads");
export const threadRoutes = new Hono();

// GET /threads - list all threads
threadRoutes.get("/", (c) => {
  try {
    const threads = threadPersistenceService.listThreads();
    return c.json({
      threads: threads.map((t) => ({
        remoteId: t.id,
        status: t.status,
        title: t.title,
      })),
    });
  } catch (error) {
    logger.error("Error listing threads:", error);
    return c.json({ error: "Failed to list threads" }, 500);
  }
});

// POST /threads - create thread
threadRoutes.post("/", async (c) => {
  try {
    const body = await c.req.json();
    const parsed = CreateThreadSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Thread id is required" }, 400);
    }
    const thread = threadPersistenceService.createThread(parsed.data.id);
    return c.json({ remoteId: thread.id, externalId: undefined }, 201);
  } catch (error) {
    logger.error("Error creating thread:", error);
    return c.json({ error: "Failed to create thread" }, 500);
  }
});

// GET /threads/:id - get thread
threadRoutes.get("/:id", (c) => {
  try {
    const thread = threadPersistenceService.getThread(c.req.param("id"));
    if (!thread) {
      return c.json({ error: "Thread not found" }, 404);
    }
    return c.json({
      remoteId: thread.id,
      status: thread.status,
      title: thread.title,
    });
  } catch (error) {
    logger.error("Error fetching thread:", error);
    return c.json({ error: "Failed to fetch thread" }, 500);
  }
});

// PATCH /threads/:id - update thread
threadRoutes.patch("/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json();
    const parsed = UpdateThreadSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "Invalid update data", details: parsed.error.issues },
        400,
      );
    }
    if (parsed.data.title !== undefined) {
      threadPersistenceService.renameThread(id, parsed.data.title);
    }
    if (parsed.data.status === "archived") {
      threadPersistenceService.archiveThread(id);
    }
    if (parsed.data.status === "regular") {
      threadPersistenceService.unarchiveThread(id);
    }
    return c.json({ success: true });
  } catch (error) {
    logger.error("Error updating thread:", error);
    return c.json({ error: "Failed to update thread" }, 500);
  }
});

// DELETE /threads/:id - delete thread
threadRoutes.delete("/:id", (c) => {
  try {
    threadPersistenceService.deleteThread(c.req.param("id"));
    return c.json({ success: true });
  } catch (error) {
    logger.error("Error deleting thread:", error);
    return c.json({ error: "Failed to delete thread" }, 500);
  }
});

// GET /threads/:id/messages - load messages
threadRoutes.get("/:id/messages", (c) => {
  try {
    const messages = threadPersistenceService.loadMessages(c.req.param("id"));
    return c.json({ messages });
  } catch (error) {
    logger.error("Error loading messages:", error);
    return c.json({ error: "Failed to load messages" }, 500);
  }
});
