/**
 * Pipeline ② — chaptered INTERNET novels: per-chapter fetch (network) →
 * per-chapter rewrite (1:1, no outline step).
 *
 * This is one of three INDEPENDENT scheduling cores from the entertainment
 * refactor. There is NO shared scheduler: each pipeline owns its own worker
 * map, p-queues, and scheduling logic. `pipelineRouter` picks the right one per
 * thread based on config, so every pipeline exposes the identical 7-method
 * `PipelineScheduler` contract — the REST routes and the startup hook only ever
 * talk to the router.
 *
 * What this pipeline owns — and ONLY this pipeline owns:
 *   threads whose config is `mode === "dehydrate" && novel.type === "internet"`.
 * Internet novels are pre-chaptered by the source site, so there is no outline/
 * split step: `buildOutlines` is a no-op here, kept only for interface
 * compliance. Acquisition is lazy and per-chapter — `fetchInternetChapter`
 * (../internetFetch) owns the `source_chapters` row lifecycle + final-chapter
 * detection, then `rewriteChapter` (../rewriter) owns the `rewritten_chapters`
 * row lifecycle + content. Because the rewrite is 1:1 with the source chapter,
 * the rewrite OUTPUT sequential number N coincides with source chapter N (the
 * numbers in `inFlight` / `n` / `chapterNumber` below are both — they're the
 * same thing for this pipeline).
 *
 * Concurrency model (replicated per pipeline — NOT shared): each thread gets a
 * serial p-queue (concurrency 1) lazily via `workerFor`, with an
 * `inFlight: Set<number>` dedup/lookup. `ensure(N)` enqueues the lookahead
 * window [N .. N+LOOKAHEAD], N first (highest priority). Each job acquires the
 * source if needed and then rewrites. Idempotent + resumable: a later `ensure`
 * re-evaluates the window, and `needsWork` (simplified here — no outline gate)
 * decides what still needs doing.
 */

import PQueue from "p-queue";
import log from "electron-log/main";
import { entertainmentService, threadPersistenceService } from "@/services";
import type { PipelineScheduler, WorkerLiveness } from "../shared/pipelineScheduler";
import { fetchInternetChapter } from "../internetFetch";
import { rewriteChapter } from "../rewriter";

const logger = log.scope("Dehydrate:Pipeline2:Internet");

/** Chapters kept ready ahead of the reader's current position. */
const LOOKAHEAD = 10;

interface ThreadWorker {
  queue: PQueue;
  inFlight: Set<number>; // dedup/lookup for enqueued+running chapter numbers
  target: number; // latest requested current chapter
}

/**
 * Per-thread chaptered-internet orchestrator. Each thread gets a serial p-queue
 * (concurrency 1); `ensure(N)` enqueues any missing work for the window
 * [N .. N+LOOKAHEAD], the current chapter first (priority). Each job acquires
 * the source (network) if needed, then rewrites. There is no outline step for
 * internet novels, so `needsWork` collapses to source-then-rewrite readiness
 * with no outline gate.
 */
class ChapteredInternetScheduler implements PipelineScheduler {
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
   * NO-OP for this pipeline. Internet novels have no whole-source outline/split
   * step (the source site pre-chaptered them), and acquisition is lazy and
   * per-chapter driven by `ensure`/`processChapter`. Kept only for interface
   * compliance with `PipelineScheduler`.
   */
  async buildOutlines(): Promise<void> {
    return;
  }

  /**
   * Ensure the lookahead window [n .. n+LOOKAHEAD] is processed, n first
   * (highest priority). Idempotent + dedup'd → safe for Next, TOC jumps, and
   * recovery. `n` is the REWRITE OUTPUT sequential number; for this pipeline it
   * coincides with the source chapter number (1:1).
   */
  ensure(threadId: string, n: number): void {
    const w = this.workerFor(threadId);
    const prevTarget = w.target;
    w.target = n;
    const final = entertainmentService.getFinalChapterNumber(threadId);
    const end = Math.min(n + LOOKAHEAD, final ?? n + LOOKAHEAD);
    const enqueued = this.enqueueWindow(threadId, w, n, end);
    logger.debug("ensure lookahead", {
      threadId,
      currentN: n,
      prevTarget,
      enqueued,
      inFlight: w.inFlight.size,
      queueSize: w.queue.size,
    });
  }

  /**
   * Ensure every chapter in [from, to] that needs work is enqueued — the
   * "process next N" / "process all" path. `to` is capped at the thread's known
   * finalChapterNumber; when final is unknown it is capped at `from + LOOKAHEAD`
   * so a stray "process all" (Number.MAX_SAFE_INTEGER) can't enqueue an
   * unbounded range. `from` wins target, so chapters nearer it process first
   * (enqueue priority).
   */
  ensureRange(threadId: string, from: number, to: number): void {
    const w = this.workerFor(threadId);
    w.target = from;
    const final = entertainmentService.getFinalChapterNumber(threadId);
    const end =
      final != null ? Math.min(to, final) : Math.min(to, from + LOOKAHEAD);
    const enqueued = this.enqueueWindow(threadId, w, from, end);
    logger.debug("ensureRange", {
      threadId,
      fromN: from,
      toN: to,
      end,
      enqueued,
      inFlight: w.inFlight.size,
      queueSize: w.queue.size,
    });
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
   * for the thread — the `inFlight` set. Read-only (does NOT create a worker),
   * so it returns an empty set for a thread that has never been touched.
   * Returns a copy so callers can iterate safely.
   */
  getInFlight(threadId: string): Set<number> {
    const w = this.workers.get(threadId);
    return w ? new Set(w.inFlight) : new Set<number>();
  }

  /**
   * Startup recovery: resume interrupted work for the threads this pipeline
   * owns — config `mode === "dehydrate" && novel.type === "internet"`. Fetch is
   * lazy per-chapter, so resuming is just kicking the lookahead via
   * `ensure(threadId, 1)`; `needsWork` + idempotency sort out what still needs
   * doing (and a fully-complete thread is a no-op). Fire-and-forget per thread.
   * Safe on a fresh install (no threads → no-op).
   */
  resumeAll(): void {
    const allThreads = threadPersistenceService.listThreadsByMode("entertainment");
    let resumed = 0;
    let skipped = 0;
    for (const t of allThreads) {
      const threadId = t.id;
      const config = entertainmentService.getParsedConfig(threadId);
      if (!config || config.mode !== "dehydrate" || config.novel.type !== "internet") {
        skipped++; // not this pipeline's thread
        continue;
      }
      resumed++;
      logger.info("resuming chaptered-internet on startup", {
        threadId,
        title: t.title,
      });
      this.ensure(threadId, 1);
    }
    logger.info("startup recovery scan complete", {
      totalThreads: allThreads.length,
      resumed,
      skipped,
    });
  }

  // --- internals ---------------------------------------------------------

  /**
   * Decide whether chapter `c` still needs processing. SIMPLIFIED for this
   * pipeline — no outline gate (internet novels have no outline step). Collapses
   * to source-then-rewrite readiness, with "error" statuses treated as terminal
   * (only `retryFailed` re-enqueues them).
   */
  private needsWork(threadId: string, c: number): boolean {
    const final = entertainmentService.getFinalChapterNumber(threadId);
    if (final != null && c > final) return false; // past known end
    const source = entertainmentService.getSourceChapter(threadId, c);
    if (!source) return true; // internet: acquire (no source row yet)
    if (source.status === "error") return false; // terminal — only retryFailed re-enqueues
    if (source.status !== "fetched") return true; // re-acquire stuck "fetching"
    const rewrite = entertainmentService.getRewrittenChapter(threadId, c);
    if (rewrite?.status === "error") return false; // terminal
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
        logger.error("chapter job failed", {
          threadId,
          chapterNumber: c,
          err,
        }),
      )
      .finally(() => w.inFlight.delete(c));
  }

  /**
   * One chapter, serial per thread: acquire 原文 (network) → rewrite 重写.
   * The scheduler does NO DB writes — it only reads (to make scheduling
   * decisions) and branches on the status each worker reports back. The fetcher
   * owns the source-row lifecycle + final-chapter bookkeeping; the rewriter
   * owns the rewrite-row lifecycle + content. Both persist their own terminal
   * status, so this just decides whether to proceed to the next phase.
   */
  private async processChapter(threadId: string, c: number): Promise<void> {
    const config = entertainmentService.getParsedConfig(threadId);
    // Only chaptered-internet dehydrate threads belong to this pipeline.
    if (!config || config.mode !== "dehydrate" || config.novel.type !== "internet") {
      logger.warn("not a chaptered-internet dehydrate thread; skipping", {
        threadId,
        chapterNumber: c,
        mode: config?.mode,
        novelType: config?.novel.type,
      });
      return;
    }
    // Execution-time final cap: the lookahead enqueues [N..N+10] before the
    // book's end is known, so chapters past the discovered final can still be
    // dequeued. Skip them here — this is also what cancels the loop once the
    // fetcher reports the final chapter.
    const finalCap = entertainmentService.getFinalChapterNumber(threadId);
    if (finalCap != null && c > finalCap) {
      logger.debug("skip — past final chapter", { threadId, c, finalCap });
      return;
    }

    logger.info("processing chapter", { threadId, chapterNumber: c });

    // 1) Acquire 原文 if needed. The internet fetcher owns its row lifecycle +
    //    final-chapter handling and reports status: "fetched" → proceed to
    //    rewrite; "finalChapter" | "error" → stop. `config.novel` is narrowed to
    //    `InternetNovel` here by the discriminated union, matching the fetcher's
    //    first-arg type.
    const source = entertainmentService.getSourceChapter(threadId, c);
    if (!source || source.status !== "fetched") {
      const outcome = await fetchInternetChapter(config.novel, c, { threadId });
      if (outcome !== "fetched") return; // finalChapter | error → no rewrite
    }

    // 2) Rewrite — the rewriter owns its row + content and reports a terminal
    //    status. For ② the rewrite row is 1:1 with the source chapter
    //    (sourceChapterStart/End fall back to chapterNumber on the read side
    //    when null), so `rewriteChapter` is called as-is.
    await rewriteChapter(threadId, c, config.options);
  }
}

/** The single chaptered-internet pipeline scheduler instance. */
export const chapteredInternetScheduler: PipelineScheduler =
  new ChapteredInternetScheduler();
