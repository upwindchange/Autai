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
import { pipelineRouter } from "@agents/workers/entertainmentWorker/shared/pipelineRouter";
import { LOOKAHEAD } from "@agents/workers/entertainmentWorker/shared/pipelineScheduler";
import { decodeNovelFile } from "@agents/workers/entertainmentWorker/pipeline1ChapteredFile/fileDecoder";
import { deriveChapterPhase, EntertainmentConfigSchema } from "@shared";
import log from "electron-log/main";

const logger = log.scope("ApiServer:Entertainment");

export const entertainmentRoutes = new Hono();

const PositionSchema = z.object({
  chapterNumber: z.number().int().min(1),
});

const WorkerSchema = z.object({
  chapterNumber: z.number().int().min(1),
});

// "process next N" (count) or "process all" (all). `from` is the anchor chapter.
const ProcessSchema = z.object({
  from: z.number().int().min(1),
  count: z.number().int().min(1).optional(),
  all: z.boolean().optional(),
});

const IngestSchema = z.object({
  config: EntertainmentConfigSchema,
  // Native pick: backend reads the file by path → detects encoding. Browser
  // fallback: renderer sends base64 bytes. Exactly one is present.
  fsPath: z.string().optional(),
  fileBytesBase64: z.string().optional(),
});

const SetupSchema = z.object({
  config: EntertainmentConfigSchema,
});

const BookmarkAnchorSchema = z.object({
  percentile: z.number().min(0).max(100),
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
function applyConfig(
  threadId: string,
  config: z.infer<typeof EntertainmentConfigSchema>,
): void {
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
      return c.json(
        { error: "Invalid request body", details: parsed.error.issues },
        400,
      );
    }
    applyConfig(threadId, parsed.data.config);
    // The internet fetcher discovers the book's final chapter during the crawl
    // (phase 1's FinalChapterError when no next chapter is found), so no
    // finalChapterNumber is set up front.
    return c.json({ ok: true }, 202);
  } catch (error) {
    logger.error("Error in setup:", error);
    return c.json({ error: "Failed to set up thread" }, 500);
  }
});

// POST /entertainment/threads/:threadId/ingest — file wizard "Upload &
// Continue": backend detects encoding + decodes (iconv) and persists the raw
// text + zero consumed offset. Chapter SPLITTING is done by the outliner later;
// this step only stores the decoded blob. The dehydrate loop is NOT kicked here
// — Start's `ensureWorker → ensureRange` does that, by which point raw text is
// guaranteed committed (the wizard gates Start on this response). The response
// resolves only after the DB write, so the renderer can rely on raw text being
// present when this returns.
entertainmentRoutes.post("/threads/:threadId/ingest", async (c) => {
  try {
    const threadId = c.req.param("threadId");
    const body = await c.req.json().catch(() => ({}));
    const parsed = IngestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "Invalid request body", details: parsed.error.issues },
        400,
      );
    }
    const { config, fsPath, fileBytesBase64 } = parsed.data;
    // Ingest serves file novels only (internet novels use /setup).
    if (config.novel.type !== "file") {
      return c.json({ error: "Ingest requires a file novel" }, 400);
    }
    if (!fsPath && !fileBytesBase64) {
      return c.json({ error: "fsPath or fileBytesBase64 is required" }, 400);
    }

    logger.info("ingest request", {
      threadId,
      novelType: config.novel.type,
      via: fsPath ? "fsPath" : "base64",
      nonNovelSource: config.options.nonNovelSource,
      crossChapterStrength: config.options.crossChapter.strength,
      filename: config.novel.filename,
    });
    // applyConfig runs first (synchronous) → setupEntertainmentThread on the
    // first config write emits `threads:metadataUpdated`, so the sidebar shows
    // the filename-based title immediately while decode is still running.
    applyConfig(threadId, config);

    // One-time ingestion. The blob is held in the DB only for the outline
    // run's duration (cleared at EOF by the runner) so crash-resume can re-read
    // it without touching the (possibly moved) source file. rawConsumedOffset
    // is reset to 0 here. finalChapterNumber is NOT set — unknown until the
    // outliner finishes splitting; it sets it at EOF.
    const decoded = await decodeNovelFile({ fsPath, base64: fileBytesBase64 });
    // Reject an empty file before any DB write / LLM call.
    if (!decoded.trim()) {
      logger.warn("ingest rejected — decoded file is empty", { threadId });
      return c.json({ error: "The file is empty" }, 400);
    }
    entertainmentService.setRawNovelText(threadId, decoded);
    entertainmentService.setLastReadChapterNumber(threadId, 1);
    logger.info("file decoded + raw text persisted", {
      threadId,
      charLen: decoded.length,
      byteEstimate: fsPath ? "(fsPath)" : (fileBytesBase64?.length ?? 0),
    });

    return c.json({ ok: true });
  } catch (error) {
    logger.error("Error in ingest:", error);
    return c.json({ error: "Failed to ingest novel" }, 500);
  }
});

// GET /entertainment/threads/:threadId/chapters — per-chapter pipeline progress
// (source + rewrite statuses merged), ordered, with a derived reader-facing
// `phase` (a DotMatrix state string computed from the statuses + the scheduler's
// inFlight set). Drives the TOC + reader states.
entertainmentRoutes.get("/threads/:threadId/chapters", (c) => {
  try {
    const threadId = c.req.param("threadId");
    const progress = entertainmentService.listChapterProgress(threadId);
    const inFlight = pipelineRouter.getInFlight(threadId);
    const chapters = progress.map((ch) => ({
      ...ch,
      phase: deriveChapterPhase(ch, inFlight),
    }));
    const novelType = entertainmentService.getNovelType(threadId);
    const finalChapterNumber =
      entertainmentService.getFinalChapterNumber(threadId);
    return c.json({ chapters, novelType, finalChapterNumber });
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
    const inFlight = pipelineRouter.getInFlight(threadId);
    return c.json({
      chapter: { ...chapter, phase: deriveChapterPhase(chapter, inFlight) },
    });
  } catch (error) {
    logger.error("Error getting chapter:", error);
    return c.json({ error: "Failed to get chapter" }, 500);
  }
});

// GET /entertainment/threads/:threadId/position — last-read chapter (recovery).
entertainmentRoutes.get("/threads/:threadId/position", (c) => {
  const threadId = c.req.param("threadId");
  const lastReadChapterNumber =
    entertainmentService.getLastReadChapterNumber(threadId);
  return c.json({ lastReadChapterNumber });
});

// POST /entertainment/threads/:threadId/position — persist current chapter.
entertainmentRoutes.post("/threads/:threadId/position", async (c) => {
  try {
    const threadId = c.req.param("threadId");
    const body = await c.req.json().catch(() => ({}));
    const parsed = PositionSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "Invalid request body", details: parsed.error.issues },
        400,
      );
    }
    entertainmentService.setLastReadChapterNumber(
      threadId,
      parsed.data.chapterNumber,
    );
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
  return c.json(pipelineRouter.getInfo(threadId));
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
      return c.json(
        { error: "Invalid request body", details: parsed.error.issues },
        400,
      );
    }
    const { chapterNumber } = parsed.data;
    pipelineRouter.ensureRange(
      threadId,
      chapterNumber,
      chapterNumber + LOOKAHEAD,
    );
    const info = pipelineRouter.getInfo(threadId);
    logger.debug("worker ensure", {
      threadId,
      chapterNumber,
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

// POST /entertainment/threads/:threadId/process — batch-process chapters:
// "process next N" (count) or "process all" (all). `from` is the anchor
// chapter; ensureRange caps `to` at the book's final chapter and enqueues.
entertainmentRoutes.post("/threads/:threadId/process", async (c) => {
  try {
    const threadId = c.req.param("threadId");
    const body = await c.req.json().catch(() => ({}));
    const parsed = ProcessSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "Invalid request body", details: parsed.error.issues },
        400,
      );
    }
    const { from, count, all } = parsed.data;
    const to = all ? Number.MAX_SAFE_INTEGER : from + (count ?? 1) - 1;
    pipelineRouter.ensureRange(threadId, from, to);
    const info = pipelineRouter.getInfo(threadId);
    logger.debug("process range", {
      threadId,
      from,
      to,
      all,
      count,
      ...info,
    });
    return c.json(info);
  } catch (error) {
    logger.error("Error processing range:", error);
    return c.json({ error: "Failed to process range" }, 500);
  }
});

// POST /entertainment/threads/:threadId/reprocess-failed — re-enqueue every
// errored chapter (source or rewrite status "error") for the thread. The ONLY
// path that retries failed chapters: needsWork treats "error" as terminal, so
// the lookahead/poll path and /process skip them. Returns worker liveness.
entertainmentRoutes.post("/threads/:threadId/reprocess-failed", (c) => {
  try {
    const threadId = c.req.param("threadId");
    pipelineRouter.retryFailed(threadId);
    const info = pipelineRouter.getInfo(threadId);
    logger.debug("reprocess failed", { threadId, ...info });
    return c.json(info);
  } catch (error) {
    logger.error("Error reprocessing failed:", error);
    return c.json({ error: "Failed to reprocess failed chapters" }, 500);
  }
});

// POST /entertainment/threads/:threadId/stop — stop ALL in-flight work on a
// thread: abort the running outline agent AND the running rewrite, drain the
// pending rewrite queue, and clear the in-flight set. Read-only on the DB (no
// rows deleted/marked terminal); rows left mid-run self-heal on the next open.
// The reader's "Stop" button calls this before abandoning the thread.
entertainmentRoutes.post("/threads/:threadId/stop", (c) => {
  try {
    const threadId = c.req.param("threadId");
    pipelineRouter.stop(threadId);
    logger.info("stopped thread work", { threadId });
    return c.json({ ok: true });
  } catch (error) {
    logger.error("Error stopping thread:", error);
    return c.json({ error: "Failed to stop thread" }, 500);
  }
});

// GET /entertainment/threads/:threadId/config — read the thread's persisted
// entertainment config (mode + novel source + options). Used by the reader's
// in-flight settings editor to seed its form from the DB. Returns 404 when the
// thread has no entertainment config.
entertainmentRoutes.get("/threads/:threadId/config", (c) => {
  try {
    const threadId = c.req.param("threadId");
    const config = entertainmentService.getParsedConfig(threadId);
    if (!config) return c.json({ error: "No config for thread" }, 404);
    return c.json({ config });
  } catch (error) {
    logger.error("Error reading config:", error);
    return c.json({ error: "Failed to read config" }, 500);
  }
});

// PUT /entertainment/threads/:threadId/config — update the thread's options
// mid-run WITHOUT re-running one-time thread setup. The next agent the pipeline
// enqueues re-reads config via `getParsedConfig` and rebuilds its prompt from
// the new options, so a mid-run edit takes effect on the next rewrite/outline.
// (On pipeline ② this is immediate; pipeline ①/③'s rewriters pick it up once
// their settings-driven prompt builders land.) Validates the whole config with
// the Zod schema. Does NOT touch novelSource/mode semantics.
entertainmentRoutes.put("/threads/:threadId/config", async (c) => {
  try {
    const threadId = c.req.param("threadId");
    const body = await c.req.json().catch(() => ({}));
    const parsed = SetupSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "Invalid request body", details: parsed.error.issues },
        400,
      );
    }
    entertainmentService.upsertEntertainmentConfig(threadId, parsed.data.config);
    logger.info("updated config", {
      threadId,
      mode: parsed.data.config.mode,
      novelType: parsed.data.config.novel.type,
    });
    return c.json({ ok: true });
  } catch (error) {
    logger.error("Error updating config:", error);
    return c.json({ error: "Failed to update config" }, 500);
  }
});

// GET /entertainment/threads/:threadId/export?range=current|fromCurrent|all&chapter=<n>
// — download rewritten chapters as plain text (.txt). `current` = just chapter;
// `fromCurrent` = chapter → last ready; `all` = every ready chapter. The browser
// handles the download via a same-origin <a download> (cookie auto-attaches for
// remote-auth; standalone has no auth), so no Blob/fetch plumbing is needed.
entertainmentRoutes.get("/threads/:threadId/export", (c) => {
  try {
    const threadId = c.req.param("threadId");
    const range = (c.req.query("range") ?? "all") as
      "current" | "fromCurrent" | "all";
    const chapter = Number(c.req.query("chapter") ?? NaN);
    let query: { from?: number; to?: number };
    if (range === "current") {
      if (!Number.isInteger(chapter) || chapter < 1) {
        return c.json({ error: "Invalid chapter for range=current" }, 400);
      }
      query = { from: chapter, to: chapter };
    } else if (range === "fromCurrent") {
      if (!Number.isInteger(chapter) || chapter < 1) {
        return c.json({ error: "Invalid chapter for range=fromCurrent" }, 400);
      }
      query = { from: chapter };
    } else {
      query = {};
    }
    const chapters = entertainmentService.listExportChapters(threadId, query);
    if (chapters.length === 0) {
      return c.json({ error: "No processed chapters to export" }, 404);
    }
    const body = chapters
      .map((ch) => {
        const header = ch.title?.trim() || `第${ch.chapterNumber}章`;
        return `${header}\n\n${ch.content.trim()}`;
      })
      .join("\n\n\n");
    const title =
      threadPersistenceService.getThread(threadId)?.title?.trim() ?? "";
    const utf8Name = `${title || "novel"}-${range}.txt`;
    const disposition = `attachment; filename="chapters.txt"; filename*=UTF-8''${encodeURIComponent(utf8Name)}`;
    return c.text(body, 200, {
      "Content-Type": "text/plain;charset=utf-8",
      "Content-Disposition": disposition,
    });
  } catch (error) {
    logger.error("Error exporting:", error);
    return c.json({ error: "Failed to export" }, 500);
  }
});

// --- Bookmarks -------------------------------------------------------------
// Saved reading spots. The renderer works in chapter numbers (never the DB id),
// so create takes chapterNumber and the service resolves the rewrittenChapter
// id. list/delete are scoped by threadId. `anchor` is a JSON coordinate
// ({ percentile }); the reader decides the shape.

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
