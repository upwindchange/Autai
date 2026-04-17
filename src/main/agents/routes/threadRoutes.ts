import { Hono } from "hono";
import { threadPersistenceService, searchService } from "@/services";
import {
  CreateThreadSchema,
  UpdateThreadSchema,
  AddThreadTagSchema,
} from "../schemas/apiSchemas";
import log from "electron-log/main";

const logger = log.scope("ApiServer:Threads");
export const threadRoutes = new Hono();

// GET /threads - list all threads (regular + archived)
threadRoutes.get("/", async (c) => {
  try {
    const threads = await threadPersistenceService.listAllThreads();
    return c.json({
      threads: threads.map((t) => ({
        remoteId: t.id,
        status: t.status,
        title: t.title,
        tags: t.tags,
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
    const thread = await threadPersistenceService.createThread(parsed.data.id);
    return c.json({ remoteId: thread.id, externalId: undefined }, 201);
  } catch (error) {
    logger.error("Error creating thread:", error);
    return c.json({ error: "Failed to create thread" }, 500);
  }
});

// POST /threads/archive-all - archive all regular threads
threadRoutes.post("/archive-all", async (c) => {
  try {
    await threadPersistenceService.archiveAllThreads();
    return c.json({ success: true });
  } catch (error) {
    logger.error("Error archiving all threads:", error);
    return c.json({ error: "Failed to archive threads" }, 500);
  }
});

// DELETE /threads/bulk - bulk delete threads by status
threadRoutes.delete("/bulk", async (c) => {
  try {
    const body = await c.req.json();
    const status = body?.status as "regular" | "archived" | undefined;
    await threadPersistenceService.deleteAllThreads(status);
    return c.json({ success: true });
  } catch (error) {
    logger.error("Error deleting threads:", error);
    return c.json({ error: "Failed to delete threads" }, 500);
  }
});

// PATCH /threads/bulk-status - bulk update thread status (archive/unarchive)
threadRoutes.patch("/bulk-status", async (c) => {
  try {
    const body = await c.req.json();
    const { threadIds, status } = body as {
      threadIds: string[];
      status: "regular" | "archived";
    };
    if (!Array.isArray(threadIds) || !status) {
      return c.json({ error: "threadIds array and status are required" }, 400);
    }
    for (const id of threadIds) {
      if (status === "archived") {
        await threadPersistenceService.archiveThread(id);
      } else {
        await threadPersistenceService.unarchiveThread(id);
      }
    }
    return c.json({ success: true });
  } catch (error) {
    logger.error("Error bulk updating thread status:", error);
    return c.json({ error: "Failed to update thread statuses" }, 500);
  }
});

// POST /threads/bulk-delete - bulk delete threads by IDs
threadRoutes.post("/bulk-delete", async (c) => {
  try {
    const body = await c.req.json();
    const { threadIds } = body as { threadIds: string[] };
    if (!Array.isArray(threadIds)) {
      return c.json({ error: "threadIds array is required" }, 400);
    }
    for (const id of threadIds) {
      await threadPersistenceService.deleteThread(id);
    }
    return c.json({ success: true });
  } catch (error) {
    logger.error("Error bulk deleting threads:", error);
    return c.json({ error: "Failed to delete threads" }, 500);
  }
});

// GET /threads/search?q=... - search threads by title
threadRoutes.get("/search", async (c) => {
  try {
    const query = c.req.query("q") ?? "";
    if (!query.trim()) {
      return c.json({ threads: [] });
    }
    const threads = await searchService.searchThreads(
      query,
      threadPersistenceService.getTagsForThread.bind(threadPersistenceService),
    );
    return c.json({
      threads: threads.map((t) => ({
        remoteId: t.id,
        status: t.status,
        title: t.title,
        tags: t.tags,
      })),
    });
  } catch (error) {
    logger.error("Error searching threads:", error);
    return c.json({ error: "Failed to search threads" }, 500);
  }
});

// GET /threads/:id - get thread
threadRoutes.get("/:id", async (c) => {
  try {
    const thread = await threadPersistenceService.getThread(c.req.param("id"));
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
      await threadPersistenceService.renameThread(id, parsed.data.title);
    }
    if (parsed.data.status === "archived") {
      await threadPersistenceService.archiveThread(id);
    }
    if (parsed.data.status === "regular") {
      await threadPersistenceService.unarchiveThread(id);
    }
    return c.json({ success: true });
  } catch (error) {
    logger.error("Error updating thread:", error);
    return c.json({ error: "Failed to update thread" }, 500);
  }
});

// DELETE /threads/:id - delete thread
threadRoutes.delete("/:id", async (c) => {
  try {
    await threadPersistenceService.deleteThread(c.req.param("id"));
    return c.json({ success: true });
  } catch (error) {
    logger.error("Error deleting thread:", error);
    return c.json({ error: "Failed to delete thread" }, 500);
  }
});

// GET /threads/:id/messages - load messages
threadRoutes.get("/:id/messages", async (c) => {
  try {
    const messages = await threadPersistenceService.loadMessages(c.req.param("id"));
    return c.json({ messages });
  } catch (error) {
    logger.error("Error loading messages:", error);
    return c.json({ error: "Failed to load messages" }, 500);
  }
});

// POST /threads/:id/tags - add tag to thread
threadRoutes.post("/:id/tags", async (c) => {
  try {
    const threadId = c.req.param("id");
    const body = await c.req.json();
    const parsed = AddThreadTagSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "Invalid data", details: parsed.error.issues },
        400,
      );
    }
    await threadPersistenceService.addTagToThread(threadId, parsed.data.tagId);
    return c.json({ success: true }, 201);
  } catch (error) {
    logger.error("Error adding tag to thread:", error);
    return c.json({ error: "Failed to add tag to thread" }, 500);
  }
});

// DELETE /threads/:id/tags/:tagId - remove tag from thread
threadRoutes.delete("/:id/tags/:tagId", async (c) => {
  try {
    const threadId = c.req.param("id");
    const tagId = Number(c.req.param("tagId"));
    await threadPersistenceService.removeTagFromThread(threadId, tagId);
    return c.json({ success: true });
  } catch (error) {
    logger.error("Error removing tag from thread:", error);
    return c.json({ error: "Failed to remove tag from thread" }, 500);
  }
});
