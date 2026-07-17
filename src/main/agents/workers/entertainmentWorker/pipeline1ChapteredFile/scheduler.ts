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
 *   REWRITER (no LLM, reader-driven) — `ensure(n)` produces one rewrite row per
 *     source row in the reader's window [n .. n+LOOKAHEAD]. Content is just a
 *     placeholder prefix prepended to the source prose — a stand-in for the
 *     future LLM co-writer that makes the read-side spine navigable today.
 *
 * TRIGGERS. The outliner runs on exactly two events: file upload (the upload
 * route calls `buildOutlines` directly) and thread-open (folded into `ensure`:
 * when a previously-uploaded thread is opened, the reader's first `ensure`
 * kicks `buildOutlines` if the outline isn't complete). It NEVER runs on boot —
 * `resumeAll` is intentionally absent from this pipeline (the router's
 * `resumeAll` fans out to ②/③ only). `sendInfo` fires when an outline run
 * starts (passes the guards); `sendSuccess` fires when it completes.
 *
 * THE SPINE KEY. `chapterNumber` is both the source and rewrite key (they
 * mirror 1:1). The reader navigates by this number. Rewrites are produced
 * synchronously per source row within the window, so there is no per-output
 * queue — `getInfo`/`getInFlight` report liveness only for the outline run.
 *
 * This is a complete, independent scheduling core. It exposes its OWN interface
 * (`ChapteredFilePipeline`) — not the shared `PipelineScheduler`, which only ②
 * and ③ implement. The `pipelineRouter` (../shared/pipelineRouter) selects it
 * for chaptered-file threads and the upload route calls `buildOutlines` on it
 * directly.
 */

import log from "electron-log/main";
import { entertainmentService } from "@/services";
import { sendInfo, sendSuccess, sendWarning } from "@/utils/messageUtils";
import { generateOutlines } from "../outliner";
import type { WorkerLiveness } from "../shared/pipelineScheduler";

const logger = log.scope("Dehydrate:Pipeline1:File");

/** Chapters kept ready ahead of the reader's current position. */
const LOOKAHEAD = 10;

/**
 * Prefix prepended to each source chapter's prose to form its placeholder
 * rewrite. A stand-in for the future LLM co-writer — makes the read-side spine
 * navigable today with zero LLM cost.
 */
const REWRITE_PLACEHOLDER_PREFIX = "[REWRITE PLACEHOLDER]\n";

/**
 * Pipeline ①'s own scheduling contract — decoupled from the shared
 * `PipelineScheduler` (②/③) because its execution model is fundamentally
 * different (batched outline + reader-driven rewrite, no boot resume). The
 * method set overlaps the reader-facing parts the router proxies, but the
 * semantics are tailored here and documented honestly.
 */
export interface ChapteredFilePipeline {
  /**
   * Trigger/resume the outline run. Called directly by the upload route and
   * idempotently kicked by `ensure` on thread-open. Guards on `finalChapterNumber`
   * (set ⇒ the agent already finalized) and the in-memory `outlineRunning` mutex.
   * Emits `sendInfo` on start and `sendSuccess` on completion.
   */
  buildOutlines(threadId: string): Promise<void>;
  /**
   * Drive the no-LLM rewriter for the reader's window [n .. n+LOOKAHEAD], and
   * idempotently kick `buildOutlines` when the outline isn't complete (the
   * folded thread-open resume path). `n` is the chapter the reader is on.
   */
  ensure(threadId: string, n: number): void;
  /** Drive the rewriter across [from..to] (capped at finalChapterNumber). */
  ensureRange(threadId: string, from: number, to: number): void;
  /** No error states in the placeholder rewriter ⇒ nothing to retry. Returns 0. */
  retryFailed(threadId: string): number;
  /** Liveness + target — backs `GET /worker`. `active` = an outline run in progress. */
  getInfo(threadId: string): WorkerLiveness;
  /** Always empty — the rewriter is synchronous (no per-output queue). */
  getInFlight(threadId: string): Set<number>;
}

interface ThreadWorker {
  /** Re-entrancy mutex: prevents concurrent `buildOutlines` runs. */
  outlineRunning: boolean;
  /** Latest requested chapter number (reader position; tracking only). */
  target: number;
}

class ChapteredFileScheduler implements ChapteredFilePipeline {
  private workers = new Map<string, ThreadWorker>();

  private workerFor(threadId: string): ThreadWorker {
    let w = this.workers.get(threadId);
    if (!w) {
      w = { outlineRunning: false, target: 1 };
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
    sendInfo("大纲生成已开始", "正在为这本小说生成章节大纲，请稍候。");
    logger.info("phase 1: outline generation starting", {
      threadId,
      crossChapterStrength: config.options.crossChapter.strength,
      resume: entertainmentService.getConsumedOffset(threadId) > 0,
    });
    try {
      await generateOutlines(threadId, config.options.crossChapter);
      sendSuccess("大纲已生成", "章节大纲已生成至全文末尾，可以开始阅读。");
      logger.info("buildOutlines complete", {
        threadId,
        finalChapter: entertainmentService.getFinalChapterNumber(threadId),
      });
    } catch (err) {
      logger.error("buildOutlines failed", { threadId, err });
      sendWarning("大纲生成失败", "生成章节大纲时出错，请重试或重新上传文件。");
    } finally {
      w.outlineRunning = false;
    }
  }

  ensure(threadId: string, n: number): void {
    const w = this.workerFor(threadId);
    w.target = n;
    // Folded thread-open trigger: if the outline isn't complete and not already
    // running, (re)start it. Idempotent — buildOutlines' guards collapse the
    // repeated kicks from the reader's poll loop into a single run, and a
    // completed thread never re-enters.
    if (
      entertainmentService.getFinalChapterNumber(threadId) == null &&
      !w.outlineRunning
    ) {
      void this.buildOutlines(threadId).catch((err) =>
        logger.error("ensure buildOutlines failed", { threadId, n, err }),
      );
    }
    const final = entertainmentService.getFinalChapterNumber(threadId);
    const end = Math.min(n + LOOKAHEAD, final ?? n + LOOKAHEAD);
    this.driveRewriter(threadId, n, end);
  }

  ensureRange(threadId: string, from: number, to: number): void {
    const w = this.workerFor(threadId);
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
    const final = entertainmentService.getFinalChapterNumber(threadId);
    const end =
      final != null ? Math.min(to, final) : Math.min(to, from + LOOKAHEAD);
    this.driveRewriter(threadId, from, end);
  }

  retryFailed(_threadId: string): number {
    // The placeholder rewriter has no error states (everything is a synchronous
    // DB write that succeeds), and the outline is only ever (re)started on
    // upload/thread-open — never from this manual retry. So there is nothing to
    // re-enqueue.
    return 0;
  }

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

  getInFlight(_threadId: string): Set<number> {
    // The rewriter is synchronous — chapters are either rewritten or not yet
    // outlined; none are ever "in flight".
    return new Set<number>();
  }

  /**
   * Produce placeholder rewrites for every chapter in [from..to] that has a
   * committed source row but no rewrite yet. Idempotent (existing rewrite rows
   * are skipped). The rewriter MONITORS source_chapters indirectly: as the
   * outliner commits more rows, subsequent `ensure`/`ensureRange` calls pick
   * them up within the reader's window.
   */
  private driveRewriter(threadId: string, from: number, to: number): void {
    for (let c = from; c <= to; c++) {
      const src = entertainmentService.getSourceChapter(threadId, c);
      if (!src || src.outlineStatus !== "outlined") continue; // not outlined yet
      if (entertainmentService.getRewrittenChapter(threadId, c)) continue; // done
      entertainmentService.insertRewrittenChapter({
        threadId,
        chapterNumber: c,
        sourceChapterId: src.id,
        content: REWRITE_PLACEHOLDER_PREFIX + (src.content ?? ""),
        status: "rewritten",
      });
    }
  }
}

export const chapteredFileScheduler: ChapteredFilePipeline =
  new ChapteredFileScheduler();
