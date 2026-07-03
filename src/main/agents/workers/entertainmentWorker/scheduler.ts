import PQueue from "p-queue";
import log from "electron-log/main";
import { entertainmentService } from "@/services";
import { fetchInternetChapter } from "./internetFetch";
import { rewriteChapter } from "./rewriter";

const logger = log.scope("Dehydrate:Scheduler");

/** Chapters kept ready ahead of the reader's current position (point 4/7). */
const LOOKAHEAD = 10;
/** Hard cap on a single chapter job — bounds stuck jobs so they self-heal. */
const JOB_TIMEOUT_MS = 5 * 60_000;

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
        queue: new PQueue({ concurrency: 1, timeout: JOB_TIMEOUT_MS }),
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
      .filter((ch) => ch.sourceStatus === "error" || ch.rewriteStatus === "error");
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

  /** One chapter, serial per thread: acquire 原文 (internet only) → rewrite 重写. */
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
    logger.info("processing chapter", {
      threadId,
      chapterNumber: c,
      novelType: config.novel.type,
    });

    // 1) Acquire 原文. Internet: fetch on demand (stub). File: already ingested
    //    as 'fetched' — if no row, the chapter is beyond the file end (skip).
    //    Failure (throw) → terminal "error" status; only retryFailed() re-runs it.
    let source = entertainmentService.getSourceChapter(threadId, c);
    if (!source || source.status !== "fetched") {
      if (config.novel.type !== "internet") {
        logger.debug("skip acquire — no source row (file end)", {
          threadId,
          chapterNumber: c,
        });
        return; // file: nothing to acquire
      }
      logger.info("acquiring source", { threadId, chapterNumber: c });
      try {
        // Mark in-progress: insert a fresh row, or reset an existing
        // errored/stuck one so a retry shows `loading` (not a stale `error`).
        if (!source) {
          entertainmentService.insertSourceChapter({
            threadId,
            chapterNumber: c,
            status: "fetching",
          });
        } else {
          entertainmentService.updateSourceChapter(threadId, c, {
            status: "fetching",
          });
        }
        const text = await fetchInternetChapter(config.novel, c);
        entertainmentService.updateSourceChapter(threadId, c, {
          status: "fetched",
          content: text,
        });
        source = entertainmentService.getSourceChapter(threadId, c);
        logger.info("source acquired", {
          threadId,
          chapterNumber: c,
          contentLen: text.length,
        });
      } catch (err) {
        logger.error("source acquire failed", { threadId, chapterNumber: c, err });
        entertainmentService.updateSourceChapter(threadId, c, {
          status: "error",
        });
        return; // no source → don't attempt rewrite
      }
    }

    // 2) Rewrite — auto-triggered by source-fill (point 6). Same prepend stub
    //    for both file and internet routes. Failure → terminal "error" status.
    const rewrite = entertainmentService.getRewrittenChapter(threadId, c);
    if (!rewrite || rewrite.status !== "rewritten") {
      logger.info("rewriting", { threadId, chapterNumber: c });
      try {
        // Mark in-progress: insert a fresh row, or reset an existing
        // errored/stuck one so a retry shows `syncing` (not a stale `error`).
        if (!rewrite) {
          entertainmentService.insertRewrittenChapter({
            threadId,
            chapterNumber: c,
            status: "rewriting",
          });
        } else {
          entertainmentService.updateRewrittenChapter(threadId, c, {
            status: "rewriting",
          });
        }
        const rewritten = await rewriteChapter(
          source?.content ?? "",
          config.options,
        );
        entertainmentService.updateRewrittenChapter(threadId, c, {
          status: "rewritten",
          content: rewritten,
        });
        entertainmentService.touchThread(threadId);
        logger.info("chapter rewritten", {
          threadId,
          chapterNumber: c,
          contentLen: rewritten.length,
        });
      } catch (err) {
        logger.error("rewrite failed", { threadId, chapterNumber: c, err });
        entertainmentService.updateRewrittenChapter(threadId, c, {
          status: "error",
        });
      }
    } else {
      logger.debug("chapter already rewritten", {
        threadId,
        chapterNumber: c,
      });
    }
  }
}

export const dehydrateScheduler = new DehydrateScheduler();
