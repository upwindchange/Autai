/**
 * Pipeline ① — CHAPTERED FILE entertainment scheduler.
 *
 * Serves uploads whose config is `mode: "dehydrate"`, `novel.type: "file"`,
 * and NOT `options.nonNovelSource` (a chaptered novel uploaded as a single
 * text file). Two INDEPENDENT parts, each honestly named:
 *
 *   OUTLINER (LLM, batched) — `buildOutlines` runs the outliner agent's chunk
 *     loop over the whole rawText. In a single LLM pass per chunk it SPLITS the
 *     source into chapters and MERGES consecutive chapters that form a
 *     cross-chapter storyline into single source rows (a tournament arc
 *     spanning 3 original chapters becomes one source row). The unconditional
 *     DB carry-forward (last chapter's content prepended to the next chunk)
 *     completes a storyline cut at a chunk boundary. The round whose read
 *     window reaches EOF is the last batch; the agent itself finalizes the
 *     thread (sets finalChapterNumber) once that batch's rows land.
 *
 *   REWRITER (LLM, reader-driven, on-demand) — `ensureRange` enqueues a real
 *     LLM rewrite (./rewriter.ts `rewriteChapter`) for every source row in the
 *     reader's window [n .. n+LOOKAHEAD] that still needs work. Each rewrite
 *     is 1:1 with its source row (same `chapterNumber` — the reader's spine
 *     key), even when that source row covers several merged original chapters
 *     (the rewriter treats the row's `content` as one opaque prose unit).
 *
 * TRIGGERS. The outliner runs on exactly two events: file upload (the upload
 *   route calls `buildOutlines` directly) and thread-open (folded into
 *   `ensureRange`: when a previously-uploaded thread is opened, the reader's
 *   first `ensureRange` kicks `buildOutlines` if the outline isn't complete).
 *   It NEVER runs on boot — `resumeAll` is intentionally absent from this
 *   pipeline (the router's `resumeAll` fans out to ②/③ only). The REWRITER
 *   has no separate trigger: it is driven entirely by `ensureRange`, which
 *   the reader-poll route (`POST /worker`) and the manual `POST /process`
 *   both call. There is no "outline done → rewrite all" hook — rewrites are
 *   strictly on-demand within the lookahead window, so a book the user never
 *   reads past chapter 5 never spends rewrite tokens on chapter 50.
 *
 * SELF-HEAL & ROBUSTNESS (no resumeAll, no error-terminal). `needsWork`
 *   treats ONLY `status === "rewritten"` as complete. Consequences:
 *   - A row stuck in `"rewriting"` (process killed mid-agent) is auto-redone
 *     on the next `ensureRange` — the dirty flag cleans itself, no sweep.
 *   - A row in `"error"` is auto-redone too (this pipeline has no error-
 *     terminal policy; only `"rewritten"` counts as done). `retryFailed`
 *     gives the user a manual "redo all errors now" entry on top of that.
 *   - Restart with empty memory: the reader opening the thread fires
 *     `ensureRange` (entertainment-thread.tsx), which scans the window via
 *     `needsWork` and re-enqueues everything not `"rewritten"`. No boot-time
 *     `resumeAll` is needed — thread-open is the recovery path.
 *
 * THE SPINE KEY. `chapterNumber` is both the source and rewrite key (they
 *   mirror 1:1). The reader navigates by this number. Rewrites run on a serial
 *   per-thread p-queue (concurrency 1) with an `inFlight` Set dedup, so
 *   `getInfo`/`getInFlight` report real queue depth and liveness for BOTH the
 *   outline run and the rewrite queue.
 *
 * This is a complete, independent scheduling core. It exposes its OWN interface
 * (`ChapteredFilePipeline`) — not the shared `PipelineScheduler`, which only ②
 * and ③ implement. The `pipelineRouter` (../shared/pipelineRouter) selects it
 * for chaptered-file threads and the upload route calls `buildOutlines` on it
 * directly.
 */

import PQueue from "p-queue";
import log from "electron-log/main";
import { entertainmentService } from "@/services";
import { sendInfo, sendSuccess, sendWarning } from "@/utils/messageUtils";
import { i18n } from "@/i18n";
import { generateOutlines } from "../outliner";
import { rewriteChapter } from "./rewriter";
import { LOOKAHEAD, type WorkerLiveness } from "../shared/pipelineScheduler";

const logger = log.scope("Dehydrate:Pipeline1:File");

/**
 * Pipeline ①'s own scheduling contract — decoupled from the shared
 * `PipelineScheduler` (②/③) because its execution model is fundamentally
 * different (batched outline + reader-driven on-demand rewrite, no boot
 * resume). The method set overlaps the reader-facing parts the router proxies,
 * but the semantics are tailored here and documented honestly.
 */
export interface ChapteredFilePipeline {
  /**
   * Trigger/resume the outline run. Called directly by the upload route and
   * idempotently kicked by `ensureRange` on thread-open. Guards on
   * `finalChapterNumber` (set ⇒ the agent already finalized) and the in-memory
   * `outlineRunning` mutex. Emits `sendInfo` on start and `sendSuccess` on
   * completion.
   */
  buildOutlines(threadId: string): Promise<void>;
  /**
   * Drive the LLM rewriter across [from..to] (capped at finalChapterNumber),
   * and idempotently kick `buildOutlines` when the outline isn't complete (the
   * folded thread-open resume path). The reader-poll route calls this with
   * [n .. n+LOOKAHEAD] as its prefetch window; `POST /process` calls it with an
   * explicit range. If `from` is far ahead of the running rewrite, the running
   * rewrite is aborted so the far chapter is served first.
   */
  ensureRange(threadId: string, from: number, to: number): void;
  /**
   * Re-enqueue every errored rewrite row for the thread, immediately. NOT the
   * only retry path — `needsWork` already auto-redoes `"error"` rows on the
   * next `ensureRange` (this pipeline has no error-terminal policy). This is
   * the manual "Redo failed" entry the user can fire without waiting for the
   * next reader poll. Returns the count actually enqueued.
   */
  retryFailed(threadId: string): number;
  /** Liveness + target — backs `GET /worker`. `active` = outline run OR queue busy. */
  getInfo(threadId: string): WorkerLiveness;
  /** Snapshot of rewrite chapter numbers currently scheduled (enqueued or running). */
  getInFlight(threadId: string): Set<number>;
  /**
   * Stop all in-flight work on a thread: abort the running outline agent AND
   * the running rewrite, drain the pending rewrite queue, and clear the
   * in-flight set. No data is deleted; rows left mid-run self-heal on the next
   * open. No-op for a thread with no worker.
   */
  stop(threadId: string): void;
}

interface ThreadWorker {
  /** Re-entrancy mutex: prevents concurrent `buildOutlines` runs. */
  outlineRunning: boolean;
  /** Serial rewrite queue (concurrency 1) — one rewrite per thread at a time. */
  queue: PQueue;
  /** Dedup/lookup for enqueued+running rewrite chapter numbers. */
  inFlight: Set<number>;
  /** Latest requested chapter number (reader position; backs GET /worker). */
  target: number;
  /** Abort controller for the currently-RUNNING rewrite, so a far-chapter
   * `ensureRange` can preempt it (near chapters still queued are filtered out
   * by `needsWork` when their turn comes). Undefined when nothing is running. */
  abortController?: AbortController;
  /** Abort controller for a running outline pass (`buildOutlines`), so `stop`
   * can preempt the long-running outliner. Undefined when no outline is running. */
  outlineAbortController?: AbortController;
}

class ChapteredFileScheduler implements ChapteredFilePipeline {
  private workers = new Map<string, ThreadWorker>();

  private workerFor(threadId: string): ThreadWorker {
    let w = this.workers.get(threadId);
    if (!w) {
      w = {
        outlineRunning: false,
        queue: new PQueue({ concurrency: 1 }),
        inFlight: new Set(),
        target: 1,
      };
      this.workers.set(threadId, w);
    }
    return w;
  }

  async buildOutlines(threadId: string): Promise<void> {
    const config = entertainmentService.getParsedConfig(threadId);
    if (
      !config ||
      config.mode !== "dehydrate" ||
      config.novel.type !== "file" ||
      config.options.nonNovelSource
    ) {
      return; // not this pipeline
    }
    // The agent sets finalChapterNumber on the last batch — once set, the book
    // is fully outlined and re-entry is blocked.
    if (entertainmentService.getFinalChapterNumber(threadId) != null) {
      logger.info("buildOutlines skipped — outline already complete", {
        threadId,
      });
      return;
    }
    const w = this.workerFor(threadId);
    if (w.outlineRunning) {
      logger.info("buildOutlines skipped — run already in progress", {
        threadId,
      });
      return;
    }
    w.outlineRunning = true;
    // Fresh abort controller for this outline run so `stop` can preempt the
    // long-running outliner mid-round. Cleared in `finally` regardless of
    // outcome (success, failure, or abort).
    const outlineAbort = new AbortController();
    w.outlineAbortController = outlineAbort;
    sendInfo("大纲生成已开始", "正在为这本小说生成章节大纲，请稍候。");
    logger.info("phase 1: outline generation starting", {
      threadId,
      crossChapterStrength: config.options.crossChapter.strength,
      resume: entertainmentService.getConsumedOffset(threadId) > 0,
    });
    try {
      await generateOutlines(
        threadId,
        config.options.crossChapter,
        outlineAbort.signal,
      );
      sendSuccess(
        i18n.t("entertainment.outlineSucceededTitle"),
        i18n.t("entertainment.outlineSucceededBody"),
      );
      logger.info("buildOutlines complete", {
        threadId,
        finalChapter: entertainmentService.getFinalChapterNumber(threadId),
      });
    } catch (err) {
      logger.error("buildOutlines failed", { threadId, err });
      sendWarning(
        i18n.t("entertainment.outlineFailedTitle"),
        i18n.t("entertainment.outlineFailedBody"),
      );
    } finally {
      w.outlineRunning = false;
      if (w.outlineAbortController === outlineAbort) {
        w.outlineAbortController = undefined;
      }
    }
  }

  ensureRange(threadId: string, from: number, to: number): void {
    const w = this.workerFor(threadId);
    const prevTarget = w.target;
    w.target = from;
    if (
      entertainmentService.getFinalChapterNumber(threadId) == null &&
      !w.outlineRunning
    ) {
      void this.buildOutlines(threadId).catch((err) =>
        logger.error("ensureRange buildOutlines failed", {
          threadId,
          from,
          to,
          err,
        }),
      );
    }
    // Far-chapter preemption: if the reader jumped well past the running
    // rewrite, abort it so the far chapter is served first. Near chapters
    // still queued are filtered out by `needsWork` when their turn comes
    // (they're behind the new target → low priority, and once the far window
    // is processed they fall out of the reader's interest).
    if (from > prevTarget) {
      w.abortController?.abort();
      w.abortController = undefined;
    }
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

  retryFailed(threadId: string): number {
    const w = this.workerFor(threadId);
    const failed = entertainmentService
      .listChapterProgress(threadId)
      .filter((ch) => ch.rewriteStatus === "error");
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

  getInfo(threadId: string): WorkerLiveness {
    const w = this.workers.get(threadId);
    if (!w) return { active: false, target: 0, pending: 0, size: 0 };
    return {
      active: w.outlineRunning || w.queue.pending > 0 || w.queue.size > 0,
      target: w.target,
      pending: w.queue.pending,
      size: w.queue.size,
    };
  }

  getInFlight(threadId: string): Set<number> {
    const w = this.workers.get(threadId);
    return w ? new Set(w.inFlight) : new Set<number>();
  }

  // --- internals ---------------------------------------------------------

  /**
   * Decide whether source row `c` still needs a (re)write. The SELF-HEAL core:
   * ONLY `status === "rewritten"` counts as complete. A missing row, a stale
   * `"rewriting"` (process killed mid-agent), or an `"error"` all return true
   * — the next `ensureRange` / restart thread-open re-enqueues them. Combined
   * with the `inFlight` dedup, this means no row is ever double-triggered:
   * once enqueued it's in `inFlight`, and once running it's `"rewriting"` in
   * the DB (also not `"rewritten"`, but `inFlight` short-circuits before the
   * DB is even consulted).
   *
   * The OUTLINE GATE: a row needs rewrite only once its source is outlined
   * (`outlineStatus === "outlined"`). Until the outliner reaches this chapter,
   * it is skipped — later `ensureRange` calls (reader polls, restart) pick it
   * up as the outliner commits more rows.
   */
  private needsWork(threadId: string, c: number): boolean {
    const final = entertainmentService.getFinalChapterNumber(threadId);
    if (final != null && c > final) return false; // past known end
    const src = entertainmentService.getSourceChapter(threadId, c);
    if (!src || src.outlineStatus !== "outlined") return false; // not outlined yet
    const rewrite = entertainmentService.getRewrittenChapter(threadId, c);
    return !rewrite || rewrite.status !== "rewritten"; // only "rewritten" is done
  }

  /**
   * Enqueue every chapter in [from, end] that needs work, nearer `from` first
   * (higher priority). Shared by `ensureRange` (lookahead window / explicit
   * range). Idempotent via the `inFlight` dedup.
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
    logger.debug("enqueue rewrite job", {
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
        logger.error("rewrite job failed", {
          threadId,
          chapterNumber: c,
          err,
        }),
      )
      .finally(() => w.inFlight.delete(c));
  }

  /**
   * Stop all in-flight work on a thread: abort the running outline agent AND
   * the running rewrite, drain the pending rewrite queue, and clear the
   * in-flight set. Read-only on the DB — no rows are deleted or marked
   * terminal. A row left in `"rewriting"`/`"outlining"` self-heals on the next
   * `ensureRange` (its dirty flag is redone by `needsWork`). No-op for a thread
   * with no worker (never touched).
   */
  stop(threadId: string): void {
    const w = this.workers.get(threadId);
    if (!w) return;
    w.outlineAbortController?.abort();
    w.outlineAbortController = undefined;
    w.abortController?.abort();
    w.abortController = undefined;
    w.queue.clear();
    w.inFlight.clear();
    logger.info("stopped in-flight work", { threadId });
  }

  /**
   * One source row, serial per thread: rewrite 原文 → 重写. The scheduler does
   * NO DB writes of its own — it only reads (to make scheduling decisions)
   * and branches on the status the rewriter reports back. The rewriter
   * (./rewriter.ts `rewriteChapter`) owns its row lifecycle + content and
   * persists its own terminal status (`"rewritten"` via the agent's
   * `outputCoWrittenContent` tool, or `"error"` on failure). The per-run
   * `AbortController` is wired in here so a far-chapter `ensureRange` can
   * preempt a running near-chapter rewrite.
   */
  private async processChapter(threadId: string, c: number): Promise<void> {
    // Execution-time final cap: the lookahead enqueues [N..N+10] before the
    // book's end is known, so chapters past the discovered final can still be
    // dequeued. Skip them here.
    const finalCap = entertainmentService.getFinalChapterNumber(threadId);
    if (finalCap != null && c > finalCap) {
      logger.debug("skip — past final chapter", { threadId, c, finalCap });
      return;
    }
    // Outline gate, re-checked at execution time: a row enqueued as "outlined"
    // could in principle have been deleted/re-merged by the outliner's carry-
    // forward path. If it's no longer ready, skip (a later ensureRange picks
    // up the re-merged row at its new chapterNumber).
    const src = entertainmentService.getSourceChapter(threadId, c);
    if (!src || src.outlineStatus !== "outlined") {
      logger.debug("skip — source not outlined", { threadId, c });
      return;
    }

    logger.info("processing chapter", { threadId, chapterNumber: c });
    const w = this.workerFor(threadId);
    const abortController = new AbortController();
    w.abortController = abortController;
    try {
      await rewriteChapter(threadId, c, abortController.signal);
    } finally {
      if (w.abortController === abortController) {
        w.abortController = undefined;
      }
    }
  }
}

export const chapteredFileScheduler: ChapteredFilePipeline =
  new ChapteredFileScheduler();
