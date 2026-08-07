/**
 * Entertainment REST API — mounted at `/entertainment` (see apiServer.ts). This
 * is the entertainment backend surface: the wizard's file submit, chapter
 * progress + detail polling, read-position persistence, and config/export/
 * bookmarks. (The `audiobook` mode is a UI-only "coming soon" placeholder
 * today — no endpoint serves it yet.)
 */
import { Hono } from "hono";
import { z } from "zod";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import {
  entertainmentFrontendService,
  entertainmentBackendService,
  threadPersistenceService,
  threadIntelligenceService,
} from "@/services";
import { eventBus } from "@/utils/eventBus";
import {
  deriveChapterStatus,
  resolvePipelineType,
  EntertainmentConfigSchema,
} from "@shared";
import { entertainmentScheduler } from "@/agents/workers/entertainmentWorker/scheduler";
import log from "electron-log/main";

const logger = log.scope("ApiServer:Entertainment");

// Path to the compiled novel-decode worker (`decodeWorker.cjs` in out/main,
// built by the `buildDecodeWorker` vite plugin via esbuild). The main bundle's
// __dirname is out/main/, so this resolves to a sibling file. `.cjs` because
// iconv-lite is CommonJS and needs native require (ESM — the default for `.js`
// under package.json "type":"module" — can't satisfy its `require("buffer")`).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DECODE_WORKER_PATH = path.join(__dirname, "decodeWorker.cjs");

/**
 * Decode a novel file's raw bytes to a string by offloading the CPU-bound work
 * (jschardet.detect + iconv.decode + normalizeText) to a `worker_threads`
 * Worker, OFF the main-process event loop. Previously this ran inline and
 * blocked the loop for hundreds of ms to seconds on large files, freezing the
 * whole UI (window paint, the Start button's animation, options toggles).
 *
 * Auto-detects encoding (jschardet) — not every text file is UTF-8
 * (GBK/GB2312/GB18030 are common for Chinese-language novels). Bytes arrive
 * from a native filesystem path (`fsPath`, the Electron picker) or as base64
 * (`base64`, browser fallback). The worker is a pure function: bytes in →
 * normalized string out. Spawn-on-demand, terminated after it replies.
 */
async function decodeViaWorker(input: {
  fsPath?: string;
  base64?: string;
}): Promise<string> {
  const worker = new Worker(DECODE_WORKER_PATH, {
    workerData: { fsPath: input.fsPath, base64: input.base64 },
  });
  try {
    const result = await new Promise<{
      ok: boolean;
      decoded?: string;
      error?: string;
    }>((resolve, reject) => {
      worker.once("message", (msg) => resolve(msg));
      worker.once("error", (err: Error) => reject(err));
      // A runaway decode on a pathological file should never hang the upload —
      // 30s is well beyond any realistic multi-MB novel.
      const timer = setTimeout(() => {
        void worker.terminate();
        reject(new Error("novel decode timed out"));
      }, 30_000);
      worker.once("message", () => clearTimeout(timer));
      worker.once("error", () => clearTimeout(timer));
    });
    if (!result.ok) throw new Error(result.error);
    return result.decoded ?? "";
  } finally {
    void worker.terminate();
  }
}

export const entertainmentRoutes = new Hono();

const PositionSchema = z.object({
  chapterNumber: z.number().int().min(1),
});

/** Body for the live reader cursor: the thread + chapter the reader is showing
 *  right now, or nulls to clear. The renderer resolves `currentChapterNumber
 *  ?? 1` before sending, so a thread that exists but whose reader hasn't opened
 *  yet reports chapter 1. */
const ReaderCursorSchema = z.object({
  threadId: z.string().nullable(),
  chapterNumber: z.number().int().min(1).nullable(),
});

const IngestSchema = z.object({
  config: EntertainmentConfigSchema,
  // Native pick: backend reads the file by path → detects encoding. Browser
  // fallback: renderer sends base64 bytes. Exactly one is present.
  fsPath: z.string().optional(),
  fileBytesBase64: z.string().optional(),
});

/** `{ config }` body shared by the wizard's `/ingest` and the reader's
 *  `PUT /config` (mid-run option edits). */
const ConfigBodySchema = z.object({
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
 * Persist config + first-time thread setup (title/tag). Idempotent:
 * setupEntertainmentThread only fires on the thread's first config.
 *
 * The entertainment wizard pre-creates the thread row (POST /threads) before
 * submitting config, so the row usually already exists here (isNew = false) and
 * this just writes the config + runs first-time setup. The threads:listChanged
 * emit on a genuine first-create keeps other clients — and this client's
 * tagStore-backed thread list — in sync.
 */
function applyConfig(
  threadId: string,
  config: z.infer<typeof EntertainmentConfigSchema>,
): void {
  const isNew = !threadPersistenceService.getThread(threadId);
  if (isNew) {
    threadPersistenceService.createThread(threadId, "entertainment");
    eventBus.emitEvent("threads:listChanged", null);
  }
  const isFirst = !entertainmentFrontendService.getEntertainmentConfig(threadId);
  entertainmentFrontendService.upsertEntertainmentConfig(threadId, config);
  if (isFirst) entertainmentFrontendService.setupEntertainmentThread(threadId, config);
  logger.info("applied config", {
    threadId,
    mode: config.mode,
    novelType: config.novel.type,
    isFirst,
  });
}

// POST /entertainment/threads/:threadId/ingest — file wizard "Upload &
// Continue": backend detects encoding + decodes (iconv) and persists the raw
// text + zero consumed offset. The response resolves only after the
// DB write, so the renderer can rely on raw text being present when this
// returns.
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
    // Ingest serves file novels only.
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

    const decoded = await decodeViaWorker({ fsPath, base64: fileBytesBase64 });
    // Reject an empty file before any DB write / LLM call.
    if (!decoded.trim()) {
      logger.warn("ingest rejected — decoded file is empty", { threadId });
      return c.json({ error: "The file is empty" }, 400);
    }
    entertainmentBackendService.setRawNovelText(threadId, decoded);
    entertainmentFrontendService.setLastReadChapterNumber(threadId, 1);
    logger.info("file decoded + raw text persisted", {
      threadId,
      charLen: decoded.length,
      byteEstimate: fsPath ? "(fsPath)" : (fileBytesBase64?.length ?? 0),
    });
    // Kick off the dehydrate loop in the background. Async — the route returns
    // immediately; the loop reads rawConsumedOffset from DB and runs to EOF.
    entertainmentScheduler.startFilePipeline(threadId);

    // Enrich the thread (extract real title + assign genre/trope tags) from
    // the opening of the decoded text. Fire-and-forget — runs alongside the
    // dehydrate loop; the deterministic title from applyConfig is the instant
    // placeholder this refines.
    threadIntelligenceService
      .enrichEntertainmentThreadFromDb(threadId)
      .catch((err) => {
        logger.warn("Entertainment enrichment failed:", err);
      });
    return c.json({ ok: true });
  } catch (error) {
    logger.error("Error in ingest:", error);
    return c.json({ error: "Failed to ingest novel" }, 500);
  }
});

// GET /entertainment/threads/:threadId/chapters — per-chapter progress
// (source + rewrite statuses merged), ordered, each carrying a derived `status`
// ({ phase, messageKey, messageParams }) computed from the statuses + the
// thread's pipeline. Drives the TOC + reader states; the renderer renders
// `status.phase` via DotMatrix and `t(status.messageKey, status.messageParams)`
// for the copy, with no mapping.
entertainmentRoutes.get("/threads/:threadId/chapters", (c) => {
  try {
    const threadId = c.req.param("threadId");
    const progress = entertainmentFrontendService.listChapterProgress(threadId);
    const pipeline = resolvePipelineType(
      entertainmentFrontendService.getParsedConfig(threadId),
    );
    const chapters = progress.map((ch) => ({
      ...ch,
      status: deriveChapterStatus(ch, { pipeline }),
    }));
    const novelType = entertainmentFrontendService.getNovelType(threadId);
    const finalChapterNumber =
      entertainmentFrontendService.getFinalChapterNumber(threadId);
    return c.json({ chapters, novelType, finalChapterNumber });
  } catch (error) {
    logger.error("Error listing chapters:", error);
    return c.json({ error: "Failed to list chapters" }, 500);
  }
});

// GET /entertainment/threads/:threadId/chapters/:n — single-chapter detail
// (statuses + rewritten prose; null content until rewritten) with a derived
// `status`. The poll target.
entertainmentRoutes.get("/threads/:threadId/chapters/:n", (c) => {
  try {
    const threadId = c.req.param("threadId");
    const n = Number(c.req.param("n"));
    if (!Number.isInteger(n) || n < 1) {
      return c.json({ error: "Invalid chapter number" }, 400);
    }
    const chapter = entertainmentFrontendService.getChapterDetail(threadId, n);
    const pipeline = resolvePipelineType(
      entertainmentFrontendService.getParsedConfig(threadId),
    );
    return c.json({
      chapter: {
        ...chapter,
        status: deriveChapterStatus(chapter, { pipeline }),
      },
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
    entertainmentFrontendService.getLastReadChapterNumber(threadId);
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
    entertainmentFrontendService.setLastReadChapterNumber(
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

// PUT /entertainment/reader-cursor — set or clear the LIVE in-memory reader
// cursor (the thread + chapter the reader is currently showing). This is NOT
// the persisted recovery position (POST .../position) — it is a volatile
// main-process pointer pushed by the reader so workers can read "where is the
// reader right now" without a DB trip. A null threadId (or null chapterNumber)
// clears it: wizard open with no thread, abandoned, or entertainment mode
// unmounted. Not thread-scoped (unlike .../position) because the clear case has
// no threadId.
entertainmentRoutes.put("/reader-cursor", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const parsed = ReaderCursorSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "Invalid request body", details: parsed.error.issues },
        400,
      );
    }
    const { threadId, chapterNumber } = parsed.data;
    // Thread switch: if the reader moved away from a different thread, abort
    // that thread's in-flight runner before adopting the new cursor.
    const prev = entertainmentFrontendService.getReaderCursor();
    if (prev && prev.threadId !== threadId) {
      entertainmentScheduler.stopThread(prev.threadId);
    }
    if (threadId == null || chapterNumber == null) {
      entertainmentFrontendService.setReaderCursor(null);
    } else {
      entertainmentFrontendService.setReaderCursor({ threadId, chapterNumber });
      // Resume unfinished work for the thread now in focus. Idempotent —
      // no-ops if a runner is already in flight (the reader polls this often).
      entertainmentScheduler.resumeOnOpen(threadId);
    }
    return c.json({ ok: true });
  } catch (error) {
    logger.error("Error setting reader cursor:", error);
    return c.json({ error: "Failed to set reader cursor" }, 500);
  }
});

// POST /entertainment/threads/:threadId/prefetch — internet wizard "Fetch &
// Continue": persist config + start fetching source chapters WITHOUT
// rewriting. The wizard advances to options immediately; fetching fills
// `source_chapters` in the background so the reader has content sooner once
// the user presses Start. Internet novels only (file novels use /ingest).
entertainmentRoutes.post("/threads/:threadId/prefetch", async (c) => {
  const threadId = c.req.param("threadId");
  const body = await c.req.json().catch(() => ({}));
  const parsed = ConfigBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid body", details: parsed.error.issues }, 400);
  }
  applyConfig(threadId, parsed.data.config);
  if (parsed.data.config.novel.type !== "internet") {
    return c.json({ error: "Prefetch requires an internet novel" }, 400);
  }
  entertainmentScheduler.startInternetPrefetch(threadId);
  return c.json({ ok: true });
});

// POST /entertainment/threads/:threadId/start — internet wizard "Start":
// persist the user's final options, then run fetch (idempotent — skips already
// fetched chapters) + rewrite together. File threads don't use this; their
// loop starts at /ingest.
entertainmentRoutes.post("/threads/:threadId/start", async (c) => {
  const threadId = c.req.param("threadId");
  const body = await c.req.json().catch(() => ({}));
  const parsed = ConfigBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid body", details: parsed.error.issues }, 400);
  }
  applyConfig(threadId, parsed.data.config); // store final options for the rewriter
  entertainmentScheduler.startInternetPipeline(threadId); // fetch + rewrite
  return c.json({ ok: true });
});

// POST /entertainment/threads/:threadId/resume — re-evaluate the thread's DB
// state and continue unfinished work. Footer "Process next N" / "Process all".
// No body needed — the scheduler reads the persisted config.
entertainmentRoutes.post("/threads/:threadId/resume", async (c) => {
  const threadId = c.req.param("threadId");
  entertainmentScheduler.resumeOnOpen(threadId);
  return c.json({ ok: true });
});

// POST /entertainment/threads/:threadId/reprocess-failed — re-enqueue
// errored chapters (source or rewrite "error"). Footer "Redo failed".
entertainmentRoutes.post("/threads/:threadId/reprocess-failed", async (c) => {
  const threadId = c.req.param("threadId");
  const enqueued = entertainmentScheduler.retryFailed(threadId);
  return c.json({ ok: true, enqueued });
});

// GET /entertainment/threads/:threadId/config — read the thread's persisted
// entertainment config (mode + novel source + options). Used by the reader's
// in-flight settings editor to seed its form from the DB. Returns 404 when the
// thread has no entertainment config.
entertainmentRoutes.get("/threads/:threadId/config", (c) => {
  try {
    const threadId = c.req.param("threadId");
    const config = entertainmentFrontendService.getParsedConfig(threadId);
    if (!config) return c.json({ error: "No config for thread" }, 404);
    return c.json({ config });
  } catch (error) {
    logger.error("Error reading config:", error);
    return c.json({ error: "Failed to read config" }, 500);
  }
});

// PUT /entertainment/threads/:threadId/config — update the thread's options
// mid-run WITHOUT re-running one-time thread setup. Validates the whole config
// with the Zod schema. Does NOT touch novelSource/mode semantics.
entertainmentRoutes.put("/threads/:threadId/config", async (c) => {
  try {
    const threadId = c.req.param("threadId");
    const body = await c.req.json().catch(() => ({}));
    const parsed = ConfigBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "Invalid request body", details: parsed.error.issues },
        400,
      );
    }
    entertainmentFrontendService.upsertEntertainmentConfig(threadId, parsed.data.config);
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
    const chapters = entertainmentFrontendService.listExportChapters(threadId, query);
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
    return c.json({ bookmarks: entertainmentFrontendService.listBookmarks(threadId) });
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
    const bookmark = entertainmentFrontendService.createBookmark(
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
    entertainmentFrontendService.deleteBookmark(threadId, id);
    return c.json({ ok: true });
  } catch (error) {
    logger.error("Error deleting bookmark:", error);
    return c.json({ error: "Failed to delete bookmark" }, 500);
  }
});
