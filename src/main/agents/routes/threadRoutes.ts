import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { threadPersistenceService, searchService } from "@/services";
import { eventBus } from "@/utils/eventBus";
import { userProviders } from "@/db/schema";
import { getDb } from "@/db";
import * as registry from "@agents/providers/registry";
import { sendInfo } from "@/utils/messageUtils";
import { i18n } from "@/i18n";
import {
  CreateThreadSchema,
  UpdateThreadSchema,
  AddThreadTagSchema,
} from "../schemas/apiSchemas";
import log from "electron-log/main";

const logger = log.scope("ApiServer:Threads");
export const threadRoutes = new Hono();

// GET /threads - list threads for a mode (?mode=chat|entertainment, default chat).
// Returns regular + archived of that mode; the client filters by status.
threadRoutes.get("/", (c) => {
  try {
    const mode =
      (c.req.query("mode") as "chat" | "entertainment" | undefined) ?? "chat";
    const threads = threadPersistenceService.listThreadsByMode(mode);
    return c.json({
      threads: threads.map((t) => ({
        id: t.id,
        status: t.status,
        mode: t.mode,
        title: t.title,
        tags: t.tags,
      })),
    });
  } catch (error) {
    logger.error("Error listing threads:", error);
    return c.json({ error: "Failed to list threads" }, 500);
  }
});

// POST /threads - create thread. When no id is provided, the backend generates
// one (the single source of truth for thread identity). The mode defaults to
// "chat"; entertainment's wizard-start posts { mode: "entertainment" } with no
// id and uses the returned { id }.
threadRoutes.post("/", async (c) => {
  try {
    const body = await c.req.json();
    const parsed = CreateThreadSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Invalid thread creation request" }, 400);
    }
    const id = parsed.data.id ?? randomUUID();
    const thread = threadPersistenceService.createThread(
      id,
      parsed.data.mode ?? "chat",
    );
    eventBus.emitEvent("threads:listChanged", null);
    return c.json({ id: thread.id }, 201);
  } catch (error) {
    logger.error("Error creating thread:", error);
    return c.json({ error: "Failed to create thread" }, 500);
  }
});

// POST /threads/archive-all - archive all regular threads of a mode
threadRoutes.post("/archive-all", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const mode = (body?.mode as "chat" | "entertainment") ?? "chat";
    threadPersistenceService.archiveAllThreads(mode);
    eventBus.emitEvent("threads:listChanged", null);
    return c.json({ success: true });
  } catch (error) {
    logger.error("Error archiving all threads:", error);
    return c.json({ error: "Failed to archive threads" }, 500);
  }
});

// DELETE /threads/bulk - bulk delete threads by status within a mode
threadRoutes.delete("/bulk", async (c) => {
  try {
    const body = await c.req.json();
    const status = body?.status as "regular" | "archived" | undefined;
    const mode = (body?.mode as "chat" | "entertainment") ?? "chat";
    if (!status) {
      return c.json({ error: "status is required" }, 400);
    }
    threadPersistenceService.deleteAllThreads(status, mode);
    eventBus.emitEvent("threads:listChanged", null);
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
        threadPersistenceService.archiveThread(id);
      } else {
        threadPersistenceService.unarchiveThread(id);
      }
    }
    eventBus.emitEvent("threads:listChanged", null);
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
      threadPersistenceService.deleteThread(id);
    }
    eventBus.emitEvent("threads:listChanged", null);
    return c.json({ success: true });
  } catch (error) {
    logger.error("Error bulk deleting threads:", error);
    return c.json({ error: "Failed to delete threads" }, 500);
  }
});

// GET /threads/search?q=... - search threads by title (scoped to ?mode= when given)
threadRoutes.get("/search", (c) => {
  try {
    const query = c.req.query("q") ?? "";
    if (!query.trim()) {
      return c.json({ threads: [] });
    }
    const mode = c.req.query("mode") as "chat" | "entertainment" | undefined;
    const threads = searchService.searchThreads(
      query,
      threadPersistenceService.getTagsForThread.bind(threadPersistenceService),
      mode,
    );
    return c.json({
      threads: threads.map((t) => ({
        id: t.id,
        status: t.status,
        mode: t.mode,
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
threadRoutes.get("/:id", (c) => {
  try {
    const thread = threadPersistenceService.getThread(c.req.param("id"));
    if (!thread) {
      return c.json({ error: "Thread not found" }, 404);
    }
    return c.json({
      id: thread.id,
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
    if (parsed.data.chatOverride !== undefined) {
      threadPersistenceService.setThreadChatOverride(
        id,
        parsed.data.chatOverride,
      );
    }
    // Refresh the thread list unless this was a chatOverride-only change. The
    // per-thread model override isn't shown in the list and the header picker
    // already updates instantly via its RAM store, so it needs no reload.
    if (
      parsed.data.chatOverride === undefined ||
      parsed.data.title !== undefined ||
      parsed.data.status !== undefined
    ) {
      eventBus.emitEvent("threads:listChanged", null);
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
    eventBus.emitEvent("threads:listChanged", null);
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

// GET /threads/:id/model — read-once-on-load: returns the per-thread chat
// override, validated. If the saved provider/model no longer exists, purges
// the override (writes null/null), notifies the user, and returns default.
// Also returns the per-thread model params + system prompt override
// (chat_model_params JSON, chat_system_prompt text), so the renderer can
// repopulate the thread-level settings panel on load.
threadRoutes.get("/:id/model", (c) => {
  const empty = {
    providerId: null,
    modelId: null,
    params: null,
    systemPrompt: null,
  };
  try {
    const id = c.req.param("id");
    const thread = threadPersistenceService.getThread(id);
    if (!thread || !thread.chatProviderId || !thread.chatModelId) {
      return c.json(empty);
    }

    const db = getDb();
    const providerRow = db
      .select()
      .from(userProviders)
      .where(eq(userProviders.id, thread.chatProviderId))
      .get();
    const valid =
      !!providerRow &&
      registry
        .getModels(providerRow.providerDir)
        .some((m) => m.file === thread.chatModelId);

    const params =
      thread.chatModelParams ?
        (() => {
          try {
            return JSON.parse(thread.chatModelParams);
          } catch {
            return null;
          }
        })()
      : null;
    const systemPrompt = thread.chatSystemPrompt;

    if (!valid) {
      sendInfo(
        i18n.t("agents.modelUnavailableTitle"),
        i18n.t("agents.modelUnavailableBody"),
      );
      // Purge the invalid provider/model but keep params/systemPrompt — they're
      // independent of the model identity and the user may re-pick a model.
      threadPersistenceService.setThreadChatOverride(id, {
        providerId: null,
        modelId: null,
        params,
        systemPrompt,
      });
      return c.json({ providerId: null, modelId: null, params, systemPrompt });
    }

    logger.debug("Thread model override loaded", {
      id,
      providerId: thread.chatProviderId,
      modelId: thread.chatModelId,
      hasParams: !!params,
      hasSystemPrompt: !!systemPrompt,
    });
    return c.json({
      providerId: thread.chatProviderId,
      modelId: thread.chatModelId,
      params,
      systemPrompt,
    });
  } catch (error) {
    logger.error("Error loading thread model:", error);
    return c.json(empty);
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
    threadPersistenceService.addTagToThread(threadId, parsed.data.tagId);
    return c.json({ success: true }, 201);
  } catch (error) {
    logger.error("Error adding tag to thread:", error);
    return c.json({ error: "Failed to add tag to thread" }, 500);
  }
});

// DELETE /threads/:id/tags/:tagId - remove tag from thread
threadRoutes.delete("/:id/tags/:tagId", (c) => {
  try {
    const threadId = c.req.param("id");
    const tagId = Number(c.req.param("tagId"));
    threadPersistenceService.removeTagFromThread(threadId, tagId);
    return c.json({ success: true });
  } catch (error) {
    logger.error("Error removing tag from thread:", error);
    return c.json({ error: "Failed to remove tag from thread" }, 500);
  }
});
