/**
 * Entertainment REST API — mounted at `/entertainment` (see apiServer.ts). This
 * is the sole entertainment backend surface: the wizard's file/internet submit,
 * chapter progress + detail polling, read-position persistence, and the worker
 * liveness/nudge endpoints. It drives the dehydrate scheduler directly; there
 * is no streaming chat path. (The `interactive` mode is a UI-only "coming soon"
 * placeholder today — no endpoint serves it yet.)
 */
import { Hono } from "hono";
import { z } from "zod";
import { entertainmentService, threadPersistenceService } from "@/services";
import { dehydrateScheduler } from "@agents/workers/entertainmentWorker/scheduler";
import {
  decodeNovelFile,
  ingestNovel,
} from "@agents/workers/entertainmentWorker/ingest";
import { EntertainmentConfigSchema } from "@shared";
import log from "electron-log/main";

const logger = log.scope("ApiServer:Entertainment");

export const entertainmentRoutes = new Hono();

const PositionSchema = z.object({
  chapterNumber: z.number().int().min(1),
});

const WorkerSchema = z.object({
  chapterNumber: z.number().int().min(1),
});

const UploadSchema = z.object({
  config: EntertainmentConfigSchema,
  // Native pick: backend reads the file by path → detects encoding. Browser
  // fallback: renderer sends base64 bytes. Exactly one is present.
  fsPath: z.string().optional(),
  fileBytesBase64: z.string().optional(),
  filename: z.string().optional(),
});

const SetupSchema = z.object({
  config: EntertainmentConfigSchema,
});

const BookmarkAnchorSchema = z.object({
  scrollRatio: z.number().min(0).max(1),
});

const CreateBookmarkSchema = z.object({
  chapterNumber: z.number().int().min(1),
  anchor: BookmarkAnchorSchema.optional(),
  label: z.string().optional(),
  note: z.string().optional(),
});

/**
 * Persist config + first-time thread setup (title/tag). Shared by the upload
 * (file) and setup (internet) wizard paths. Idempotent: setupEntertainmentThread
 * only fires on the thread's first config.
 */
function applyConfig(threadId: string, config: z.infer<typeof EntertainmentConfigSchema>): void {
  if (!threadPersistenceService.getThread(threadId)) {
    threadPersistenceService.createThread(threadId, "entertainment");
  }
  const isFirst = !entertainmentService.getEntertainmentConfig(threadId);
  entertainmentService.upsertEntertainmentConfig(threadId, config);
  if (isFirst) entertainmentService.setupEntertainmentThread(threadId, config);
  logger.info("applied config", {
    threadId,
    mode: config.mode,
    novelType: config.novel.type,
    isFirst,
  });
}

// POST /entertainment/threads/:threadId/setup — internet wizard submit: save
// config + set up the thread. Acquisition/rewriting start when the reader opens
// chapter 1 and polls the worker.
entertainmentRoutes.post("/threads/:threadId/setup", async (c) => {
  try {
    const threadId = c.req.param("threadId");
    const body = await c.req.json().catch(() => ({}));
    const parsed = SetupSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Invalid request body", details: parsed.error.issues }, 400);
    }
    applyConfig(threadId, parsed.data.config);
    return c.json({ ok: true }, 202);
  } catch (error) {
    logger.error("Error in setup:", error);
    return c.json({ error: "Failed to set up thread" }, 500);
  }
});

// POST /entertainment/threads/:threadId/upload — file wizard submit: backend
// detects encoding + decodes (iconv), splits into chapters, bulk-inserts source
// rows, then kicks off rewriting chapter 1 (+lookahead).
entertainmentRoutes.post("/threads/:threadId/upload", async (c) => {
  try {
    const threadId = c.req.param("threadId");
    const body = await c.req.json().catch(() => ({}));
    const parsed = UploadSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Invalid request body", details: parsed.error.issues }, 400);
    }
    const { config, fsPath, fileBytesBase64 } = parsed.data;
    if (!fsPath && !fileBytesBase64) {
      return c.json({ error: "fsPath or fileBytesBase64 is required" }, 400);
    }

    logger.info("upload", {
      threadId,
      novelType: config.novel.type,
      via: fsPath ? "fsPath" : "base64",
    });
    applyConfig(threadId, config);

    // One-time ingestion. Guard against double-upload for an existing thread.
    if (entertainmentService.listSourceChapters(threadId).length === 0) {
      const decoded = decodeNovelFile({ fsPath, base64: fileBytesBase64 });
      const count = ingestNovel(threadId, decoded);
      entertainmentService.setLastChapterNumber(threadId, 1);
      logger.info("file uploaded + ingested", { threadId, count });
    }

    // Start rewriting the first window (file chapters are already sourced).
    dehydrateScheduler.ensure(threadId, 1, config);
    return c.json({ ok: true }, 202);
  } catch (error) {
    logger.error("Error in upload:", error);
    return c.json({ error: "Failed to upload novel" }, 500);
  }
});

// GET /entertainment/threads/:threadId/chapters — per-chapter pipeline progress
// (source + rewrite statuses merged), ordered. Drives the TOC + reader states.
entertainmentRoutes.get("/threads/:threadId/chapters", (c) => {
  try {
    const threadId = c.req.param("threadId");
    const chapters = entertainmentService.listChapterProgress(threadId);
    const novelType = entertainmentService.getNovelType(threadId);
    return c.json({ chapters, novelType });
  } catch (error) {
    logger.error("Error listing chapters:", error);
    return c.json({ error: "Failed to list chapters" }, 500);
  }
});

// GET /entertainment/threads/:threadId/chapters/:n — single-chapter detail
// (statuses + rewritten prose; null content until rewritten). The poll target.
entertainmentRoutes.get("/threads/:threadId/chapters/:n", (c) => {
  try {
    const threadId = c.req.param("threadId");
    const n = Number(c.req.param("n"));
    if (!Number.isInteger(n) || n < 1) {
      return c.json({ error: "Invalid chapter number" }, 400);
    }
    const chapter = entertainmentService.getChapterDetail(threadId, n);
    return c.json({ chapter });
  } catch (error) {
    logger.error("Error getting chapter:", error);
    return c.json({ error: "Failed to get chapter" }, 500);
  }
});

// GET /entertainment/threads/:threadId/position — last-read chapter (recovery).
entertainmentRoutes.get("/threads/:threadId/position", (c) => {
  const threadId = c.req.param("threadId");
  const lastChapterNumber = entertainmentService.getLastChapterNumber(threadId);
  return c.json({ lastChapterNumber });
});

// POST /entertainment/threads/:threadId/position — persist current chapter.
entertainmentRoutes.post("/threads/:threadId/position", async (c) => {
  try {
    const threadId = c.req.param("threadId");
    const body = await c.req.json().catch(() => ({}));
    const parsed = PositionSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Invalid request body", details: parsed.error.issues }, 400);
    }
    entertainmentService.setLastChapterNumber(threadId, parsed.data.chapterNumber);
    logger.debug("position set", {
      threadId,
      chapterNumber: parsed.data.chapterNumber,
    });
    return c.json({ ok: true });
  } catch (error) {
    logger.error("Error setting position:", error);
    return c.json({ error: "Failed to set position" }, 500);
  }
});

// GET /entertainment/threads/:threadId/worker — query liveness of the per-thread
// dehydration worker (is it processing? what chapter? queue depth).
entertainmentRoutes.get("/threads/:threadId/worker", (c) => {
  const threadId = c.req.param("threadId");
  return c.json(dehydrateScheduler.getInfo(threadId));
});

// POST /entertainment/threads/:threadId/worker — ensure a worker is processing
// the window for `chapterNumber` (start-if-absent; idempotent). Used by the
// reader's poll loop when a chapter isn't ready yet.
entertainmentRoutes.post("/threads/:threadId/worker", async (c) => {
  try {
    const threadId = c.req.param("threadId");
    const body = await c.req.json().catch(() => ({}));
    const parsed = WorkerSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Invalid request body", details: parsed.error.issues }, 400);
    }
    dehydrateScheduler.ensure(threadId, parsed.data.chapterNumber);
    const info = dehydrateScheduler.getInfo(threadId);
    logger.debug("worker ensure", {
      threadId,
      chapterNumber: parsed.data.chapterNumber,
      active: info.active,
      target: info.target,
      pending: info.pending,
      size: info.size,
    });
    return c.json(info);
  } catch (error) {
    logger.error("Error starting worker:", error);
    return c.json({ error: "Failed to start worker" }, 500);
  }
});

// --- Bookmarks -------------------------------------------------------------
// Saved reading spots. The renderer works in chapter numbers (never the DB id),
// so create takes chapterNumber and the service resolves the rewrittenChapter
// id. list/delete are scoped by threadId. `anchor` is a JSON coordinate
// ({ scrollRatio }); the reader decides the shape.

// GET /entertainment/threads/:threadId/bookmarks — all bookmarks, newest first,
// with chapterNumber + title joined for display + jump.
entertainmentRoutes.get("/threads/:threadId/bookmarks", (c) => {
  try {
    const threadId = c.req.param("threadId");
    return c.json({ bookmarks: entertainmentService.listBookmarks(threadId) });
  } catch (error) {
    logger.error("Error listing bookmarks:", error);
    return c.json({ error: "Failed to list bookmarks" }, 500);
  }
});

// POST /entertainment/threads/:threadId/bookmarks — save the current reading
// spot. 400 if the chapter has no rewrite row yet (defensive — the reader only
// bookmarks ready chapters).
entertainmentRoutes.post("/threads/:threadId/bookmarks", async (c) => {
  try {
    const threadId = c.req.param("threadId");
    const body = await c.req.json().catch(() => ({}));
    const parsed = CreateBookmarkSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "Invalid request body", details: parsed.error.issues },
        400,
      );
    }
    const { chapterNumber, anchor, label, note } = parsed.data;
    const bookmark = entertainmentService.createBookmark(
      threadId,
      chapterNumber,
      anchor,
      label,
      note,
    );
    return c.json({ bookmark }, 201);
  } catch (error) {
    logger.error("Error creating bookmark:", error);
    return c.json({ error: "Failed to create bookmark" }, 500);
  }
});

// DELETE /entertainment/threads/:threadId/bookmarks/:id — remove one bookmark
// (scoped by threadId).
entertainmentRoutes.delete("/threads/:threadId/bookmarks/:id", (c) => {
  try {
    const threadId = c.req.param("threadId");
    const id = c.req.param("id");
    entertainmentService.deleteBookmark(threadId, id);
    return c.json({ ok: true });
  } catch (error) {
    logger.error("Error deleting bookmark:", error);
    return c.json({ error: "Failed to delete bookmark" }, 500);
  }
});
