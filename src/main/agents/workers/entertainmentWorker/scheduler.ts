import PQueue from "p-queue";
import log from "electron-log/main";
import { entertainmentService, threadPersistenceService } from "@/services";
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
   * Branches on availability:
   *   - file novel + not `nonNovelSource` → run the outliner agent. Outlines are
   *     generated in batches sized to the model's context window; each chapter's
   *     outline landing fires `ensure(N)` so its rewrite is enqueued the moment
   *     it's ready, without waiting for the whole book. `needsWork` holds any
   *     chapter whose outline is still `"outlining"` back until its own outline
   *     lands.
   *   - otherwise (internet novel, or `nonNovelSource`) → mark every chapter's
   *     outline row `"skipped"` and `ensure(1)` directly: there is no outline
   *     step, so rewriting starts immediately and `needsWork` treats `"skipped"`
   *     as "outline ready".
   *
   * Re-entrancy: a run completes only when EVERY source chapter has an
   * `outlined` row. If so, bail out so a retried upload / a poll-triggered
   * call / the startup recovery scan never launches a second run. If not
   * (some chapters are `outlining`/`error`/`skipped`/missing), `generateOutlines`
   * resumes from the first unfinished chapter — it skips already-`outlined`
   * chapters and rebuilds the prior-outline context from them.
   */
  async buildOutlines(threadId: string): Promise<void> {
    const config = entertainmentService.getParsedConfig(threadId);
    if (!config || config.mode !== "dehydrate") return;
    if (entertainmentService.isOutlineComplete(threadId)) {
      logger.debug("outlines already complete; skipping", { threadId });
      return;
    }
    const crossChapterAvailable =
      config.novel.type === "file" && !config.options.nonNovelSource;
    if (!crossChapterAvailable) {
      // No outline step for this novel — mark every chapter skipped and let
      // rewriting proceed ungated.
      const sourceCount =
        entertainmentService.listSourceChapters(threadId).length;
      logger.info("outlines skipped (cross-chapter unavailable)", {
        threadId,
        novelType: config.novel.type,
        nonNovelSource: config.options.nonNovelSource,
        sourceCount,
      });
      skipOutlines(threadId);
      this.ensure(threadId, 1);
      return;
    }
    logger.info("starting outline generation", { threadId });
    const { outlined, errored } = await generateOutlines(
      threadId,
      config.options.crossChapter,
      (chapterNumber) => this.ensure(threadId, chapterNumber),
    );
    logger.info("outline generation complete", {
      threadId,
      outlined,
      errored,
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
      // Skip threads that are fully outlined or have no source chapters —
      // buildOutlines would no-op anyway, but this avoids spawning promises +
      // logs for the common case (most threads are either complete or not yet
      // uploaded).
      if (entertainmentService.isOutlineComplete(threadId)) {
        skipped++;
        continue;
      }
      const sourceCount =
        entertainmentService.listSourceChapters(threadId).length;
      if (sourceCount === 0) {
        skipped++;
        continue;
      }
      resumed++;
      logger.info("resuming outline generation on startup", {
        threadId,
        title: t.title,
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
    // novels an outline row always exists once `buildOutlines` has started
    // (it pre-inserts one per source chapter); `"outlining"` holds the chapter
    // back until its outline lands, and a missing row means the outline run
    // hasn't begun yet (also hold back, so rewriting can't race ahead of it).
    // Internet novels have no outline step (acquired one at a time), so a
    // missing row there means "no gate" — proceed.
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

    // 1) Acquire 原文. Internet only — file chapters are pre-ingested as
    //    'fetched', so a missing row means the file's end (skip). The fetcher
    //    owns its row lifecycle + final-chapter handling and reports status:
    //    "fetched" → proceed to rewrite; "finalChapter" | "error" → stop.
    const source = entertainmentService.getSourceChapter(threadId, c);
    if (!source || source.status !== "fetched") {
      if (config.novel.type !== "internet") {
        logger.debug("skip acquire — no source row (file end)", {
          threadId,
          chapterNumber: c,
        });
        return; // file: nothing to acquire
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
