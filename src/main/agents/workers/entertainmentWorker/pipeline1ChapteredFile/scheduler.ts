/**
 * Pipeline ① — CHAPTERED FILE entertainment scheduler.
 *
 * Serves uploads whose config is `mode: "dehydrate"`, `novel.type: "file"`,
 * and NOT `options.nonNovelSource` (a chaptered novel uploaded as a single
 * text file). This pipeline has TWO sequential phases that do NOT map to a
 * simple per-chapter fetch→rewrite loop:
 *
 *   PHASE 1 — outline (split + outline): delegates to the outliner agent
 *     (`generateOutlines`), which runs the chunk loop over the whole rawText,
 *     and in a single LLM pass per chunk both SPLITS the source into chapters
 *     AND writes a `source_chapters` row + a `chapter_outlines` row per source
 *     chapter, progressively. Phase 1 does NOT rewrite per-source-chapter here
 *     (unlike the legacy single scheduler) — it just runs the outliner to
 *     completion so the chapter spine exists.
 *
 *   PHASE 2 — co-write placeholder (NO LLM): once outlines are produced, all
 *     source chapters are MERGED into fixed 2-chapter co-writing WINDOWS
 *     ([1,2],[3,4],…), and each window becomes ONE rewrite output row whose
 *     content is a placeholder joining the window's source prose. This is a
 *     stand-in for the future LLM co-writer — it makes the read-side spine
 *     navigable end-to-end today.
 *
 * THE SPINE KEY. The `n` in `ensure(threadId, n)` / `getInFlight` / etc. is
 * the REWRITE OUTPUT sequential number (1,2,3,…), NOT a source chapter number
 * — because one output may cover source chapters [5,6] (a 2-chapter window).
 * The reader navigates by output number. Outputs are produced synchronously
 * and in bulk during phase 2 (no per-output job processing), so this pipeline
 * does NOT enqueue per-output jobs into the p-queue (unlike ②/③); the
 * `workers`/`inFlight`/queue structures are kept only for interface compliance,
 * and `inFlight` always stays empty.
 *
 * CONCURRENCY. One `outlineRunning` mutex per thread guards `buildOutlines`
 * against concurrent invocations (upload-trigger + startup-resume + a poll
 * re-entry all racing). `ensure`/`ensureRange` are fire-and-forget kick-offs
 * of `buildOutlines` when the pipeline isn't yet fully complete; the mutex
 * collapses concurrent kicks into a single run.
 *
 * This is a complete, independent scheduling core — it implements the full
 * `PipelineScheduler` interface and owns only the threads matching its config
 * shape. The `pipelineRouter` (../shared/pipelineRouter) selects it.
 */

import PQueue from "p-queue";
import log from "electron-log/main";
import { entertainmentService, threadPersistenceService } from "@/services";
import { generateOutlines } from "../outliner";
import type {
  PipelineScheduler,
  WorkerLiveness,
} from "../shared/pipelineScheduler";

const logger = log.scope("Dehydrate:Pipeline1:File");

/** Fixed co-writing window size: one rewrite output covers 2 source chapters. */
const CO_WRITE_WINDOW = 2;

interface ThreadWorker {
  /**
   * Serial p-queue kept for structural parity with the scheduler contract. This
   * pipeline does NOT enqueue per-output jobs (outputs are bulk-built in phase
   * 2), so the queue stays empty — it exists so the `ThreadWorker` shape and
   * `getInfo`/`getInFlight` stay consistent across all three pipelines.
   */
  queue: PQueue;
  /** Always empty for ① — no per-output jobs are ever enqueued. */
  inFlight: Set<number>;
  /** Latest requested output number (reader position; tracking only). */
  target: number;
  /**
   * Re-entrancy mutex: prevents concurrent `buildOutlines` runs (upload +
   * startup-resume + a poll re-entry all racing on the same thread).
   * `isOutlineComplete && coWriteComplete` alone is insufficient — two
   * concurrent fresh runs both see "not complete" and both start.
   */
  outlineRunning: boolean;
}

class ChapteredFileScheduler implements PipelineScheduler {
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

  // --- the main driver: both phases run here, sequentially ----------------

  /**
   * Drive BOTH phases for a chaptered-file thread: outline (split + outline via
   * the outliner agent), then co-write placeholder (2-chapter windows, no LLM).
   *
   * Idempotent + re-entrancy-guarded:
   *   - Wrong pipeline (not dehydrate / not file / nonNovelSource) → no-op.
   *   - Already fully done (outline + co-write complete) → no-op.
   *   - A run already in progress for this thread → no-op (mutex).
   *
   * Note on `finalChapterNumber`: `generateOutlines` sets it to
   * `maxSourceChapterNumber` at EOF, but for THIS pipeline the spine is the
   * REWRITE OUTPUT count, not the source chapter count. We overwrite it to
   * `maxRewrittenChapterNumber` after both phases so the read-side spine
   * length is correct (also covers the resume case where phase 2 early-
   * returns because outputs already exist).
   */
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
    if (
      this.isOutlineComplete(threadId) &&
      this.coWriteComplete(threadId)
    ) {
      logger.info("buildOutlines skipped — pipeline already complete", {
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
    try {
      // PHASE 1: outline (split + outline). Runs the outliner's chunk loop to
      // completion; it writes source_chapters + chapter_outlines rows
      // progressively. No per-source-chapter rewrite here — phase 2 merges.
      logger.info("phase 1: outline generation starting", {
        threadId,
        crossChapterStrength: config.options.crossChapter.strength,
        resume: entertainmentService.getConsumedOffset(threadId) > 0,
      });
      await generateOutlines(threadId, config.options.crossChapter);

      // PHASE 2: co-write placeholder (no LLM). Merges source chapters into
      // 2-chapter windows, one rewrite output row per window.
      await this.runCoWritePlaceholder(threadId);

      // Overwrite finalChapterNumber: the spine is the OUTPUT count, not the
      // source count that generateOutlines set at its EOF. Done unconditionally
      // so the resume/early-return path is also corrected.
      const outputCount = entertainmentService.maxRewrittenChapterNumber(threadId);
      if (outputCount > 0) {
        entertainmentService.setFinalChapterNumber(threadId, outputCount);
      }
      logger.info("buildOutlines complete", {
        threadId,
        sourceChapters: entertainmentService.maxSourceChapterNumber(threadId),
        outputCount,
      });
    } finally {
      w.outlineRunning = false;
    }
  }

  /**
   * Phase 2 — the placeholder co-writer (NO LLM). Reads all source chapters,
   * groups them into windows of exactly 2 ([1,2],[3,4],…; a trailing single
   * chapter if the count is odd), and writes ONE rewrite output row per window.
   *
   * Idempotent: if any rewrite output already exists for the thread
   * (`maxRewrittenChapterNumber > 0`), phase 2 is assumed to have run (or
   * partially run) and this returns immediately — a fuller resume could
   * rebuild partial windows, but the placeholder keeps it simple. Output
   * numbers start at `maxRewrittenChapterNumber + 1` so resume is gap-free.
   *
   * After all windows are written, sets `finalChapterNumber` to the output
   * count and clears the rawText blob (dead weight once the run is complete).
   */
  private async runCoWritePlaceholder(threadId: string): Promise<void> {
    const sources = entertainmentService.listSourceChapters(threadId);
    if (sources.length === 0) {
      logger.warn("co-write placeholder skipped — no source chapters", {
        threadId,
      });
      return;
    }

    // Idempotent guard: phase 2 already ran (or partially ran).
    if (entertainmentService.maxRewrittenChapterNumber(threadId) > 0) {
      logger.info("co-write placeholder skipped — outputs already exist", {
        threadId,
        existingOutputs: entertainmentService.maxRewrittenChapterNumber(threadId),
      });
      return;
    }

    // Group source chapters into fixed windows of 2.
    const windows: typeof sources[] = [];
    for (let i = 0; i < sources.length; i += CO_WRITE_WINDOW) {
      windows.push(sources.slice(i, i + CO_WRITE_WINDOW));
    }

    // Write one rewrite output row per window. Output numbers are sequential
    // starting at maxRewrittenChapterNumber + 1 (1 on a fresh run), so the
    // spine is gap-free and survives resume.
    let nextOutput = entertainmentService.maxRewrittenChapterNumber(threadId) + 1;
    for (const window of windows) {
      const start = window[0].chapterNumber;
      const end = window[window.length - 1].chapterNumber;
      entertainmentService.insertRewrittenChapter({
        threadId,
        chapterNumber: nextOutput,
        sourceChapterStart: start,
        sourceChapterEnd: end,
        content: this.buildPlaceholderContent(window),
        status: "rewritten",
      });
      nextOutput++;
    }

    const outputCount = entertainmentService.maxRewrittenChapterNumber(threadId);
    entertainmentService.setFinalChapterNumber(threadId, outputCount);
    entertainmentService.clearRawNovelText(threadId);

    logger.info("co-write placeholder complete", {
      threadId,
      sourceChapters: sources.length,
      outputCount,
    });
  }

  /**
   * Build the placeholder body for one co-writing window: the literal marker
   * line, then one block per source chapter (heading line + verbatim body).
   * A null title collapses the heading to just `第N章`; null/empty content
   * yields an empty body line. Blocks are separated by a blank line.
   *
   *   [REWRITE PLACEHOLDER]
   *   第N章 {title}
   *   {content}
   *
   *   第M章 {title}
   *   {content}
   */
  private buildPlaceholderContent(
    window: { chapterNumber: number; title: string | null; content: string | null }[],
  ): string {
    const blocks = window.map((ch) => {
      const heading = ch.title
        ? `第${ch.chapterNumber}章 ${ch.title}`
        : `第${ch.chapterNumber}章`;
      const body = ch.content ?? "";
      return `${heading}\n${body}`;
    });
    return `[REWRITE PLACEHOLDER]\n${blocks.join("\n\n")}`;
  }

  // --- completion helpers -------------------------------------------------

  /** Phase 1 done: every source chapter has an `outlined` outline row. */
  private isOutlineComplete(threadId: string): boolean {
    return entertainmentService.isOutlineComplete(threadId);
  }

  /**
   * Phase 2 done (placeholder definition): once any rewrite output exists,
   * phase 2 ran. The outputs are bulk-built synchronously, so "any" ⟹ "all"
   * for the placeholder (no partial-output error state to recover from).
   */
  private coWriteComplete(threadId: string): boolean {
    return entertainmentService.maxRewrittenChapterNumber(threadId) > 0;
  }

  // --- the PipelineScheduler interface (reader-facing kicks) --------------

  /**
   * Ensure output `n` is available. For ① outputs are pre-built in bulk during
   * phase 2 (no per-output job processing), so this is a fire-and-forget kick
   * of `buildOutlines` when the pipeline isn't yet fully complete. If already
   * complete, it's a no-op. `n` is the REWRITE OUTPUT number (reader spine).
   */
  ensure(threadId: string, n: number): void {
    const w = this.workerFor(threadId);
    w.target = n;
    if (this.isOutlineComplete(threadId) && this.coWriteComplete(threadId)) {
      return; // outputs already pre-built
    }
    void this.buildOutlines(threadId).catch((err) =>
      logger.error("ensure buildOutlines failed", { threadId, n, err }),
    );
  }

  /**
   * Ensure every output in [from, to]. For ① the `from`/`to` are output
   * numbers but irrelevant to placeholder building (it builds ALL windows at
   * once), so this just fire-and-forgets `buildOutlines` if not complete. `to`
   * may be `Number.MAX_SAFE_INTEGER` for "all" — harmless here since phase 2
   * is not range-bounded.
   */
  ensureRange(threadId: string, from: number, to: number): void {
    const w = this.workerFor(threadId);
    w.target = from;
    if (this.isOutlineComplete(threadId) && this.coWriteComplete(threadId)) {
      return;
    }
    void this.buildOutlines(threadId).catch((err) =>
      logger.error("ensureRange buildOutlines failed", {
        threadId,
        from,
        to,
        err,
      }),
    );
  }

  /**
   * Retry errored outputs. The placeholder co-writer has NO error states
   * (everything is built synchronously and succeeds), so there is nothing to
   * retry. Returns 0.
   */
  retryFailed(_threadId: string): number {
    return 0;
  }

  /** Liveness + target — backs `GET /worker`. `active` reflects an in-progress
   * outline/co-write run; pending/size are 0 (no per-output queue jobs). */
  getInfo(threadId: string): WorkerLiveness {
    const w = this.workers.get(threadId);
    if (!w) return { active: false, target: 0, pending: 0, size: 0 };
    return {
      active: w.outlineRunning,
      target: w.target,
      pending: 0,
      size: 0,
    };
  }

  /**
   * Snapshot of output numbers currently scheduled. For ① no per-output jobs
   * are ever enqueued, so this is always the empty set. Returns a copy so
   * callers can iterate safely.
   */
  getInFlight(threadId: string): Set<number> {
    const w = this.workers.get(threadId);
    return w ? new Set(w.inFlight) : new Set<number>();
  }

  /**
   * Startup recovery: resume interrupted work for the threads THIS pipeline
   * owns (dehydrate + file + not nonNovelSource) that are not yet fully
   * complete (outline OR co-write still pending). Fire-and-forget per thread —
   * each `buildOutlines` runs independently; the per-thread mutex collapses
   * concurrent kicks. Safe on a fresh install (no threads → no-op).
   */
  resumeAll(): void {
    const allThreads = threadPersistenceService.listThreadsByMode("entertainment");
    let resumed = 0;
    let skipped = 0;
    for (const t of allThreads) {
      const threadId = t.id;
      const config = entertainmentService.getParsedConfig(threadId);
      if (
        !config ||
        config.mode !== "dehydrate" ||
        config.novel.type !== "file" ||
        config.options.nonNovelSource
      ) {
        skipped++; // not this pipeline
        continue;
      }
      if (this.isOutlineComplete(threadId) && this.coWriteComplete(threadId)) {
        skipped++; // fully done
        continue;
      }
      resumed++;
      logger.info("resuming chaptered-file pipeline on startup", {
        threadId,
        title: t.title,
        outlineComplete: this.isOutlineComplete(threadId),
        coWriteComplete: this.coWriteComplete(threadId),
      });
      void this.buildOutlines(threadId).catch((err) =>
        logger.error("startup resume failed", { threadId, err }),
      );
    }
    logger.info("startup recovery scan complete", {
      pipeline: "chaptered-file",
      totalThreads: allThreads.length,
      resumed,
      skipped,
    });
  }
}

export const chapteredFileScheduler: PipelineScheduler =
  new ChapteredFileScheduler();
