import PQueue from "p-queue";
import log from "electron-log/main";
import { entertainmentService, threadPersistenceService } from "@/services";
import type { EntertainmentConfig } from "@shared";
import { fetchInternetChapter } from "./internetFetch";
import { rewriteChapter } from "./rewriter";
import { generateOutlines, skipOutlines } from "./outliner";

const logger = log.scope("Dehydrate:Scheduler");

/** Chapters kept ready ahead of the reader's current position (point 4/7). */
const LOOKAHEAD = 10;

interface WorkerLiveness {
  active: boolean;
  target: number;
  pending: number;
  size: number;
}

interface ThreadWorker {
  queue: PQueue;
  inFlight: Set<number>; // dedup/lookup for enqueued+running chapter numbers
  target: number; // latest requested current chapter
  /**
   * Whether a `buildOutlines` run is currently in progress for this thread.
   * buildOutlines runs OUTSIDE the serial p-queue (it's a whole-book step whose
   * per-chapter progress callback enqueues INTO that queue), so the queue's
   * concurrency:1 does NOT serialize it. This flag prevents concurrent
   * outline runs (upload + startup-resume, or a poll-triggered re-entry) from
   * double-submitmitting the same chapters — the second call returns early.
   * `isOutlineComplete` alone is insufficient: two concurrent fresh runs both
   * see "not complete" and both start, racing on the same chapter numbers.
   */
  outlineRunning: boolean;
}

/**
 * Per-thread dehydration orchestrator. Each thread gets a serial p-queue
 * (concurrency 1); `ensure(N)` enqueues any missing work for the window
 * [N .. N+LOOKAHEAD], the current chapter first (priority). Each job acquires
 * the source (network) if needed — and acquisition auto-triggers that chapter's
 * rewrite (point 6). File chapters skip acquisition (source is bulk-ingested).
 *
 * p-queue has no native per-key queue / dependency DAG / job-lookup-by-key, so
 * `inFlight` provides dedup/lookup and the acquire→rewrite dependency is an
 * intra-job `await` (serial execution orders chapters). Idempotent + resumable:
 * a later `ensure` re-evaluates the window and re-runs incomplete chapters, so
 * interrupt recovery (point 9) reuses the same path as normal activation.
 */
class DehydrateScheduler {
  private workers = new Map<string, ThreadWorker>();

  private workerFor(threadId: string): ThreadWorker {
    let w = this.workers.get(threadId);
    if (!w) {
      w = {
        queue: new PQueue({ concurrency: 1 }),
        inFlight: new Set(),
        target: 1,
        outlineRunning: false,
      };
      this.workers.set(threadId, w);
    }
    return w;
  }

  /**
   * Ensure the lookahead window [currentN .. currentN+LOOKAHEAD] is processed,
   * capped at the book's final chapter when known. Idempotent + dedup'd → safe
   * for Next, TOC jumps far ahead, and recovery.
   */
  ensure(threadId: string, currentN: number): void {
    const w = this.workerFor(threadId);
    const prevTarget = w.target;
    w.target = currentN;
    const final = entertainmentService.getFinalChapterNumber(threadId);
    const end = Math.min(currentN + LOOKAHEAD, final ?? currentN + LOOKAHEAD);
    const enqueued = this.enqueueWindow(threadId, w, currentN, end);
    logger.debug("ensure lookahead", {
      threadId,
      currentN,
      prevTarget,
      enqueued,
      inFlight: w.inFlight.size,
      queueSize: w.queue.size,
    });
  }

  /**
   * Ensure every chapter in [fromN, toN] that needs work is enqueued — the
   * "process next N" / "process all" path. `toN` is capped at the book's final
   * chapter when known; callers may pass Number.MAX_SAFE_INTEGER for "all".
   * `fromN` wins target, so chapters nearer it process first (enqueue priority).
   */
  ensureRange(threadId: string, fromN: number, toN: number): void {
    const w = this.workerFor(threadId);
    w.target = fromN;
    const final = entertainmentService.getFinalChapterNumber(threadId);
    // Cap at the book's final chapter when known. When unknown (only a
    // degenerate, not-properly-initialized thread), bound at a lookahead-sized
    // window so a stray "process all" can't enqueue an unbounded range.
    const end =
      final != null ? Math.min(toN, final) : Math.min(toN, fromN + LOOKAHEAD);
    const enqueued = this.enqueueWindow(threadId, w, fromN, end);
    logger.debug("ensureRange", {
      threadId,
      fromN,
      toN,
      end,
      enqueued,
      inFlight: w.inFlight.size,
      queueSize: w.queue.size,
    });
  }

  /** Liveness + target — backs the worker REST API (GET /worker). */
  getInfo(threadId: string): WorkerLiveness {
    const w = this.workers.get(threadId);
    if (!w) return { active: false, target: 0, pending: 0, size: 0 };
    return {
      active: w.queue.pending > 0 || w.queue.size > 0,
      target: w.target,
      pending: w.queue.pending,
      size: w.queue.size,
    };
  }

  /**
   * Snapshot of the chapter numbers currently scheduled (enqueued or running)
   * for the thread — the `inFlight` set. Read-only (does NOT create a worker).
   * Backs the `paused` vs `stopped` distinction in the reader-facing phase: a
   * chapter is `paused` while it's in this set and not yet `loading`/`syncing`/
   * `success`/`error`. Returns a copy so callers can iterate safely.
   */
  getInFlight(threadId: string): Set<number> {
    const w = this.workers.get(threadId);
    return w ? new Set(w.inFlight) : new Set<number>();
  }

  /**
   * Re-enqueue every errored chapter for the thread (source or rewrite status
   * "error"). This is the ONLY path that retries failed chapters — `needsWork`
   * treats "error" as terminal, so the lookahead/poll path skips them. Bypasses
   * `needsWork` and enqueues directly (the `inFlight` dedup still applies).
   * Returns the count actually enqueued.
   */
  retryFailed(threadId: string): number {
    const w = this.workerFor(threadId);
    const failed = entertainmentService
      .listChapterProgress(threadId)
      .filter(
        (ch) => ch.sourceStatus === "error" || ch.rewriteStatus === "error",
      );
    let enqueued = 0;
    for (const ch of failed) {
      const n = ch.chapterNumber;
      if (w.inFlight.has(n)) continue;
      this.enqueue(threadId, w, n);
      enqueued++;
    }
    logger.info("retry failed chapters", {
      threadId,
      failed: failed.length,
      enqueued,
    });
    return enqueued;
  }

  /**
   * Build the per-chapter outline spine (章节并写 phase 1) for a file-uploaded
   * novel, then let rewriting proceed chapter-by-chapter as each outline lands.
   * This is a whole-book step (not a per-chapter queue job), so it runs OUTSIDE
   * the thread's serial p-queue; its progress callback drives rewriting by
   * calling `ensure` per chapter, which enqueues into that serial queue.
   *
   * Branches on novel type + nonNovelSource:
   *   - file novel (NOT `nonNovelSource`) → run the outliner agent, which SPLITS
   *     the raw text into chapters AND outlines each in a single LLM pass per
   *     chunk (reading the persisted rawText chunk-by-chunk, sized by the input
   *     context budget with a safe overlap). Each chapter's source row + outline
   *     landing fires `ensure(N)` so its rewrite is enqueued the moment it's
   *     ready. `needsWork` holds any chapter whose outline is still `"outlining"`
   *     back until its own outline lands.
   *   - internet novel OR `nonNovelSource` file → mark every existing source
   *     chapter's outline `"skipped"` (no outline step) and let rewriting
   *     proceed ungated. For internet novels the source site pre-chaptered it.
   *     For `nonNovelSource` files: splitting continuous non-novel text (posts,
   *     articles) into chapters is NOT yet implemented — the raw text is
   *     persisted but no split/outline pass runs. `needsWork` treats `"skipped"`
   *     as "outline ready"; with no source rows committed there's nothing to
   *     rewrite yet, so the pipeline effectively waits until split support is
   *     added for this source type.
   *
   * Re-entrancy: a run completes only when EVERY source chapter has an
   * `outlined` row (file) / a `"skipped"` row (internet). If so, bail out so a
   * retried upload / a poll-triggered call / the startup recovery scan never
   * launches a second run. If not, `generateOutlines` resumes from the last
   * committed chapter — it re-reads `rawConsumedOffset` + `maxSourceChapterNumber`
   * from the DB and continues the chunk loop.
   */
  async buildOutlines(threadId: string): Promise<void> {
    const config = entertainmentService.getParsedConfig(threadId);
    if (!config || config.mode !== "dehydrate") return;
    if (entertainmentService.isOutlineComplete(threadId)) {
      logger.info("buildOutlines skipped — outlines already complete", {
        threadId,
      });
      return;
    }
    const w = this.workerFor(threadId);
    if (w.outlineRunning) {
      logger.info("buildOutlines skipped — outline run already in progress", {
        threadId,
      });
      return;
    }
    w.outlineRunning = true;
    try {
      await this.runBuildOutlines(threadId, config);
    } finally {
      w.outlineRunning = false;
    }
  }

  /**
   * The actual outline run, factored out so `buildOutlines` can wrap it in the
   * outlineRunning guard + try/finally. Never call directly — go through
   * buildOutlines so the mutex holds.
   */
  private async runBuildOutlines(
    threadId: string,
    config: EntertainmentConfig,
  ): Promise<void> {
    if (config.novel.type === "internet" || config.options.nonNovelSource) {
      // No outline/split step: internet novels are pre-chaptered by the source
      // site; nonNovelSource files have no split implementation yet (continuous
      // text — a future pass would segment it). Mark every existing source
      // chapter's outline "skipped" so rewriting proceeds ungated for whatever
      // source rows exist (nonNovelSource has none today → nothing to rewrite).
      const sourceCount =
        entertainmentService.listSourceChapters(threadId).length;
      logger.info("outlines skipped (no split step)", {
        threadId,
        novelType: config.novel.type,
        nonNovelSource: config.options.nonNovelSource,
        sourceCount,
      });
      skipOutlines(threadId);
      this.ensure(threadId, 1);
      return;
    }
    // Chaptered file novel: the outliner splits + outlines in one pass per
    // chunk, reading the persisted rawText. (nonNovelSource files returned
    // above — no split here.)
    const consumedOffset = entertainmentService.getConsumedOffset(threadId);
    const existingChapters =
      entertainmentService.maxSourceChapterNumber(threadId);
    logger.info("starting outline generation", {
      threadId,
      crossChapterStrength: config.options.crossChapter.strength,
      resume: consumedOffset > 0,
      consumedOffset,
      existingChapters,
    });
    const { outlined, errored } = await generateOutlines(
      threadId,
      config.options.crossChapter,
      (chapterNumber) => this.ensure(threadId, chapterNumber),
    );
    logger.info("outline generation complete", {
      threadId,
      outlined,
      errored,
      finalChapter: entertainmentService.maxSourceChapterNumber(threadId),
    });
  }

  /**
   * Startup recovery scan: resume outline generation for any entertainment
   * thread whose outlines are incomplete (some source chapter lacks an
   * `outlined` row). Called once after DB init so a crashed outline run is
   * picked back up automatically on the next launch — without it, chapters
   * stuck in `outlining`/missing would block rewriting forever (the scheduler's
   * `needsWork` gates on outline readiness).
   *
   * Fire-and-forget per thread: each `buildOutlines` runs independently and
   * asynchronously. Threads with complete outlines (or no source chapters) are
   * skipped by `buildOutlines`'s own `isOutlineComplete` guard. Safe to call on
   * a fresh install (no threads → no-op).
   */
  resumeOutlines(): void {
    const allThreads = threadPersistenceService.listThreadsByMode("entertainment");
    let resumed = 0;
    let skipped = 0;
    for (const t of allThreads) {
      const threadId = t.id;
      // Skip threads that are fully outlined.
      if (entertainmentService.isOutlineComplete(threadId)) {
        skipped++;
        continue;
      }
      // Resume if there's work to do: either source chapters already landed
      // (partial file run OR an internet novel with chapters), OR there's a
      // persisted rawText blob awaiting its first outline pass (a file novel
      // that crashed between upload and outline start — source_chapters is
      // empty there, but rawText is set). The rawText check is what makes the
      // post-upload pre-outline crash recoverable.
      const sourceCount =
        entertainmentService.listSourceChapters(threadId).length;
      const hasRawText =
        entertainmentService.getRawNovelText(threadId) != null;
      if (sourceCount === 0 && !hasRawText) {
        skipped++;
        continue;
      }
      resumed++;
      logger.info("resuming outline generation on startup", {
        threadId,
        title: t.title,
        sourceCount,
        hasRawText,
      });
      void this.buildOutlines(threadId).catch((err) =>
        logger.error("startup outline resume failed", { threadId, err }),
      );
    }
    logger.info("startup recovery scan complete", {
      totalThreads: allThreads.length,
      resumed,
      skipped,
    });
  }

  // --- internals ---------------------------------------------------------

  private needsWork(threadId: string, c: number): boolean {
    const final = entertainmentService.getFinalChapterNumber(threadId);
    if (final != null && c > final) return false; // past the book's known end
    const type = entertainmentService.getNovelType(threadId);
    const source = entertainmentService.getSourceChapter(threadId, c);
    if (!source) return type === "internet"; // file: beyond end → none; internet: acquire
    // "error" is terminal: a failed chapter is never auto-retried by the
    // lookahead/poll path (avoids hammering a persistent real failure). Only
    // retryFailed() re-enqueues it.
    if (source.status === "error") return false;
    if (source.status !== "fetched") return type === "internet"; // re-acquire stuck fetching
    // Outline readiness gate (章节并写 phase 1). A chapter may proceed to
    // rewriting only once its own outline is in a terminal status. For file
    // novels the outliner commits each chapter's source row AND its outline row
    // ATOMICALLY (in one tool-call pass) — so a source row present means its
    // outline row is present too. There is no pre-inserted `outlining`
    // placeholder anymore: a missing source row means the outline run hasn't
    // reached this chapter yet (hold back); a present `outlining`/`error`
    // outline row means it's in progress/failed. Internet novels have no outline
    // step (acquired one at a time), so a missing row there means "no gate".
    const outline = entertainmentService.getOutline(threadId, c);
    if (outline) {
      if (outline.status === "outlining") {
        logger.debug("needsWork: chapter held back — outline in progress", {
          threadId,
          chapterNumber: c,
        });
        return false; // wait for this chapter's outline
      }
      // "outlined" | "skipped" | "error" → outline ready (error degrades to a
      // no-outline rewrite rather than blocking forever).
    } else if (type === "file") {
      logger.debug("needsWork: chapter held back — outline not started", {
        threadId,
        chapterNumber: c,
      });
      return false; // outline run not started yet — don't race ahead
    }
    const rewrite = entertainmentService.getRewrittenChapter(threadId, c);
    if (rewrite?.status === "error") return false; // terminal — see above
    return !rewrite || rewrite.status !== "rewritten"; // need rewrite
  }

  /**
   * Enqueue every chapter in [from, end] that needs work, nearer `from` first.
   * Shared by `ensure` (lookahead window) and `ensureRange` (explicit range).
   */
  private enqueueWindow(
    threadId: string,
    w: ThreadWorker,
    from: number,
    end: number,
  ): number {
    let enqueued = 0;
    for (let c = from; c <= end; c++) {
      if (w.inFlight.has(c)) continue;
      if (!this.needsWork(threadId, c)) continue;
      this.enqueue(threadId, w, c);
      enqueued++;
    }
    return enqueued;
  }

  private enqueue(threadId: string, w: ThreadWorker, c: number): void {
    w.inFlight.add(c);
    const priority = LOOKAHEAD - (c - w.target); // current chapter highest
    logger.debug("enqueue chapter job", {
      threadId,
      chapterNumber: c,
      priority,
    });
    w.queue
      .add(() => this.processChapter(threadId, c), {
        priority,
        id: String(c),
      })
      .catch((err) =>
        logger.error("chapter job failed", { threadId, chapterNumber: c, err }),
      )
      .finally(() => w.inFlight.delete(c));
  }

  /**
   * One chapter, serial per thread: acquire 原文 (internet only) → rewrite 重写.
   * The scheduler does NO DB writes — it only reads (to make scheduling
   * decisions) and branches on the status each worker reports back. The fetcher
   * owns the source-row lifecycle + final-chapter bookkeeping; the rewriter
   * owns the rewrite-row lifecycle + content. Both persist their own terminal
   * status, so this just decides whether to proceed to the next phase.
   */
  private async processChapter(threadId: string, c: number): Promise<void> {
    const config = entertainmentService.getParsedConfig(threadId);
    if (!config) {
      logger.warn("no entertainment config; skipping chapter", {
        threadId,
        chapterNumber: c,
      });
      return;
    }
    if (config.mode !== "dehydrate") {
      // interactive is a UI-only placeholder today; this scheduler serves
      // dehydrate only.
      logger.warn("scheduler serves dehydrate only; skipping", {
        threadId,
        chapterNumber: c,
        mode: config.mode,
      });
      return;
    }
    // Execution-time final cap: the lookahead enqueues [N..N+10] before the
    // book's end is known, so chapters past the discovered final can still be
    // dequeued. Skip them here. This is also what cancels the loop once the
    // fetcher reports the final chapter: finalChapterNumber is then set, every
    // surplus queued chapter returns here, and future ensure() windows are capped.
    const finalCap = entertainmentService.getFinalChapterNumber(threadId);
    if (finalCap != null && c > finalCap) {
      logger.debug("skip — past final chapter", { threadId, c, finalCap });
      return;
    }

    logger.info("processing chapter", {
      threadId,
      chapterNumber: c,
      novelType: config.novel.type,
    });

    // 1) Acquire 原文. Internet only — for file novels the outliner commits each
    //    chapter's source row as 'fetched' during the outline run (atomic with
    //    its outline row), so a missing row means the outline run hasn't reached
    //    this chapter yet (skip — it'll be re-enqueued as it lands). The
    //    internet fetcher owns its row lifecycle + final-chapter handling and
    //    reports status: "fetched" → proceed to rewrite; "finalChapter" |
    //    "error" → stop.
    const source = entertainmentService.getSourceChapter(threadId, c);
    if (!source || source.status !== "fetched") {
      if (config.novel.type !== "internet") {
        logger.debug("skip acquire — no source row yet (outline not reached)", {
          threadId,
          chapterNumber: c,
        });
        return; // file: outline hasn't committed this chapter yet
      }
      const outcome = await fetchInternetChapter(config.novel, c, {
        threadId,
        nonNovelSource: config.options.nonNovelSource,
      });
      if (outcome !== "fetched") return; // finalChapter | error → no rewrite
    }

    // 2) Rewrite — the rewriter owns its row + content and reports a terminal
    //    status; there is no further phase to branch on, so the outcome is the
    //    chapter's terminal state in the DB.
    await rewriteChapter(threadId, c, config.options);
  }
}

export const dehydrateScheduler = new DehydrateScheduler();
