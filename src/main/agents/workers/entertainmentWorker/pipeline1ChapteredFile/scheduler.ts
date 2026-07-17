/**
 * Pipeline ① — CHAPTERED FILE entertainment scheduler.
 *
 * Serves uploads whose config is `mode: "dehydrate"`, `novel.type: "file"`,
 * and NOT `options.nonNovelSource` (a chaptered novel uploaded as a single
 * text file). Two sequential phases:
 *
 *   PHASE 1 — outline + merge (split + outline + carry-forward): delegates to
 *     the outliner agent (`generateOutlines`), which runs the chunk loop over
 *     the whole rawText. In a single LLM pass per chunk it SPLITS the source
 *     into chapters AND MERGES consecutive chapters that form a cross-chapter
 *     storyline into single source rows (a tournament arc spanning 3 original
 *     chapters becomes one source row). The unconditional DB carry-forward
 *     (last chapter's content prepended to the next chunk, no flags) ensures a
 *     storyline cut at a chunk boundary is completed in the next round. Each
 *     committed source row carries outline + foreshadowing + outlineStatus.
 *
 *   PHASE 2 — placeholder rewrite (NO LLM): once outlines land, write ONE
 *     rewrite row per source row (strict 1:1, sourceChapterId FK). Content is
 *     a placeholder joining the source prose — a stand-in for the future LLM
 *     co-writer that makes the read-side spine navigable today.
 *
 * THE SPINE KEY. After the 1:1 redesign, `chapterNumber` is both the source
 * and rewrite key (they mirror each other). The reader navigates by this
 * number. Outputs are produced synchronously per source row (no per-output
 * queue jobs), so `inFlight` stays empty; the queue structures exist only for
 * interface parity with ②/③.
 *
 * CONCURRENCY. One `outlineRunning` mutex per thread guards `buildOutlines`
 * against concurrent invocations (upload-trigger + startup-resume + poll
 * re-entry all racing). `ensure`/`ensureRange` are fire-and-forget kick-offs
 * of `buildOutlines` when the pipeline isn't yet fully complete.
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
  /** Latest requested chapter number (reader position; tracking only). */
  target: number;
  /**
   * Re-entrancy mutex: prevents concurrent `buildOutlines` runs (upload +
   * startup-resume + a poll re-entry all racing on the same thread).
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
   * Drive BOTH phases for a chaptered-file thread: outline+merge (via the
   * outliner agent with carry-forward), then placeholder rewrite (1:1 per
   * source row, no LLM).
   *
   * Idempotent + re-entrancy-guarded:
   *   - Wrong pipeline (not dehydrate / not file / nonNovelSource) → no-op.
   *   - Already fully done (outline + rewrite complete) → no-op.
   *   - A run already in progress for this thread → no-op (mutex).
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
      this.rewriteComplete(threadId)
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
      // PHASE 1: outline + merge. Runs the outliner's chunk loop to completion;
      // it writes source_chapters rows (with outline/foreshadowing/outlineStatus)
      // progressively, merging cross-chapter storylines into single rows via
      // the unconditional carry-forward.
      logger.info("phase 1: outline generation starting", {
        threadId,
        crossChapterStrength: config.options.crossChapter.strength,
        resume: entertainmentService.getConsumedOffset(threadId) > 0,
      });
      await generateOutlines(threadId, config.options.crossChapter);

      // PHASE 2: placeholder rewrite (no LLM). One rewrite row per source row.
      await this.runPlaceholderRewrite(threadId);

      // finalChapterNumber = source chapter count (1:1, so == rewrite count).
      const chapterCount =
        entertainmentService.maxSourceChapterNumber(threadId);
      if (chapterCount > 0) {
        entertainmentService.setFinalChapterNumber(threadId, chapterCount);
      }
      logger.info("buildOutlines complete", {
        threadId,
        sourceChapters: chapterCount,
      });
    } finally {
      w.outlineRunning = false;
    }
  }

  /**
   * Phase 2 — the placeholder rewriter (NO LLM). For each source chapter that
   * doesn't yet have a rewrite row, write one with placeholder content (the
   * source prose verbatim under a marker). 1:1 with source rows
   * (sourceChapterId FK). Idempotent: source rows that already have a rewrite
   * row are skipped.
   */
  private async runPlaceholderRewrite(threadId: string): Promise<void> {
    const sources = entertainmentService.listSourceChapters(threadId);
    if (sources.length === 0) {
      logger.warn("placeholder rewrite skipped — no source chapters", {
        threadId,
      });
      return;
    }
    let written = 0;
    for (const s of sources) {
      const existing = entertainmentService.getRewrittenChapter(
        threadId,
        s.chapterNumber,
      );
      if (existing) continue; // idempotent — already has a rewrite row
      entertainmentService.insertRewrittenChapter({
        threadId,
        chapterNumber: s.chapterNumber,
        sourceChapterId: s.id,
        content: `[REWRITE PLACEHOLDER]\n${s.content ?? ""}`,
        status: "rewritten",
      });
      written++;
    }
    // rawText is dead weight once the outline run is complete.
    entertainmentService.clearRawNovelText(threadId);
    logger.info("placeholder rewrite complete", {
      threadId,
      sourceChapters: sources.length,
      written,
    });
  }

  // --- completion helpers -------------------------------------------------

  /** Phase 1 done: every source chapter has outlineStatus "outlined". */
  private isOutlineComplete(threadId: string): boolean {
    return entertainmentService.isOutlineComplete(threadId);
  }

  /**
   * Phase 2 done: every source chapter has a corresponding rewrite row. In the
   * 1:1 model this is `rewriteCount >= sourceCount`.
   */
  private rewriteComplete(threadId: string): boolean {
    const sourceCount = entertainmentService.listSourceChapters(threadId).length;
    if (sourceCount === 0) return true;
    return (
      entertainmentService.maxRewrittenChapterNumber(threadId) >= sourceCount
    );
  }

  // --- the PipelineScheduler interface (reader-facing kicks) --------------

  /**
   * Ensure chapter `n` is available. For ① outputs are pre-built in bulk during
   * phase 2 (no per-output job processing), so this is a fire-and-forget kick
   * of `buildOutlines` when the pipeline isn't yet fully complete. If already
   * complete, it's a no-op.
   */
  ensure(threadId: string, n: number): void {
    const w = this.workerFor(threadId);
    w.target = n;
    if (this.isOutlineComplete(threadId) && this.rewriteComplete(threadId)) {
      return; // already complete
    }
    void this.buildOutlines(threadId).catch((err) =>
      logger.error("ensure buildOutlines failed", { threadId, n, err }),
    );
  }

  /**
   * Ensure every chapter in [from, to]. For ① this just fire-and-forgets
   * `buildOutlines` if not complete (phase 2 builds ALL at once, not by range).
   */
  ensureRange(threadId: string, from: number, to: number): void {
    const w = this.workerFor(threadId);
    w.target = from;
    if (this.isOutlineComplete(threadId) && this.rewriteComplete(threadId)) {
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
   * Retry errored outputs. The placeholder rewriter has NO error states
   * (everything is built synchronously and succeeds), so there is nothing to
   * retry. Returns 0.
   */
  retryFailed(_threadId: string): number {
    return 0;
  }

  /** Liveness + target — backs `GET /worker`. `active` reflects an in-progress
   * outline/rewrite run; pending/size are 0 (no per-output queue jobs). */
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
   * Snapshot of chapter numbers currently scheduled. For ① no per-output jobs
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
   * complete (outline OR rewrite still pending). Fire-and-forget per thread —
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
      if (this.isOutlineComplete(threadId) && this.rewriteComplete(threadId)) {
        skipped++; // fully done
        continue;
      }
      resumed++;
      logger.info("resuming chaptered-file pipeline on startup", {
        threadId,
        title: t.title,
        outlineComplete: this.isOutlineComplete(threadId),
        rewriteComplete: this.rewriteComplete(threadId),
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
