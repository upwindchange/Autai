/**
 * Pipeline ① — CHAPTERED FILE entertainment scheduler.
 *
 * Serves uploads whose config is `mode: "dehydrate"`, `novel.type: "file"`,
 * and NOT `options.nonNovelSource`. A SINGLE autonomous loop
 * (`./dehydrateRunner.ts` `runDehydrateLoop`) reads the decoded novel text
 * (`entertainment_configs.rawText`) chunk by chunk and, per chunk, emits an
 * array of `{ content, outline }` via one `outputChapters` tool call —
 * re-chaptering, merging, and dehydrating in one pass. There is NO separate
 * outline step and NO reader-driven per-chapter rewrite queue: outline + rewrite
 * are produced together, so this scheduler is just the lifecycle shell
 * (kick / stop / resume / liveness) around the loop.
 *
 * TRIGGERS. The loop runs on two events: file upload (the upload route calls
 *   `runDehydrate` directly) and thread-open (folded into `ensureRange`: when a
 *   previously-uploaded thread is opened, the reader's first `ensureRange` kicks
 *   `runDehydrate` if the book isn't done yet). It NEVER runs on boot — this
 *   pipeline has no `resumeAll` (the router's `resumeAll` fans out to ②/③ only).
 *
 * RESUMABLE + RECOVERABLE. Every pass advances `rawConsumedOffset` inside the
 *   tool (a deterministic checkpoint). A crashed/killed/stopped run picks up
 *   from the last committed chunk on the next thread-open — same loop, same
 *   offset. `rawText` is held in the DB until EOF so crash-resume can re-read it.
 *
 * STOP. `stop` aborts the loop's AbortController; the in-flight pass aborts and
 *   the loop returns. No data is mutated — rows already written stay. After the
 *   reader's Stop button the frontend switches to a fresh wizard thread, so no
 *   auto-resume is triggered; reopening the stopped thread is what resumes it.
 *
 * The spine key is `chapterNumber` on `rewritten_chapters` (1:1 with `outlines`
 * by chapterNumber). The reader navigates by this number.
 */

import log from "electron-log/main";
import { entertainmentService } from "@/services";
import { sendInfo, sendSuccess, sendWarning } from "@/utils/messageUtils";
import { i18n } from "@/i18n";
import { runDehydrateLoop } from "./dehydrateRunner";
import type { WorkerLiveness } from "../shared/pipelineScheduler";

const logger = log.scope("Dehydrate:Pipeline1:File");

/**
 * Pipeline ①'s own scheduling contract — decoupled from the shared
 * `PipelineScheduler` (②/③) because its execution model is fundamentally
 * different (one autonomous dehydrate loop, no per-chapter queue, no boot
 * resume). The method set overlaps the reader-facing parts the router proxies,
 * but the semantics are tailored here and documented honestly.
 */
export interface ChapteredFilePipeline {
  /**
   * Trigger/resume the dehydrate loop. Called directly by the upload route and
   * idempotently kicked by `ensureRange` on thread-open. Guards on
   * `finalChapterNumber` (set ⇒ the loop already finished) and the in-memory
   * `loopRunning` mutex. Emits `sendInfo` on start and `sendSuccess` on
   * completion.
   */
  runDehydrate(threadId: string): Promise<void>;
  /**
   * Reader-poll / thread-open entry. In the one-loop model this just kicks
   * `runDehydrate` if the book isn't done and the loop isn't already running
   * (the thread-open → resume path). `from`/`to` are otherwise ignored — the
   * loop runs start→finish autonomously, not on a per-chapter window.
   */
  ensureRange(threadId: string, from: number, to: number): void;
  /**
   * Pipeline ① only ever commits fully-`rewritten` rows (no `error` rows), so
   * there is nothing to retry per-chapter — this just re-kicks the loop if it
   * isn't complete. Kept for interface compliance with the router facade.
   * Returns the count enqueued (always 0 here).
   */
  retryFailed(threadId: string): number;
  /** Liveness + target — backs `GET /worker`. `active` = loop running. */
  getInfo(threadId: string): WorkerLiveness;
  /**
   * Snapshot of chapter numbers currently scheduled. Always empty for ① (there
   * is no per-chapter queue — chapters appear as the loop commits them).
   */
  getInFlight(threadId: string): Set<number>;
  /**
   * Stop the in-flight loop: abort its AbortController. No data is deleted or
   * marked terminal; the loop returns and `loopRunning` clears. No-op for a
   * thread with no worker.
   */
  stop(threadId: string): void;
}

interface ThreadWorker {
  /** Re-entrancy mutex: prevents concurrent loop runs for one thread. */
  loopRunning: boolean;
  /** Latest requested chapter number (reader position; backs GET /worker). */
  target: number;
  /** Abort controller for the currently-RUNNING loop, so `stop` can preempt
   *  it. Undefined when nothing is running. */
  abortController?: AbortController;
}

class ChapteredFileScheduler implements ChapteredFilePipeline {
  private workers = new Map<string, ThreadWorker>();

  private workerFor(threadId: string): ThreadWorker {
    let w = this.workers.get(threadId);
    if (!w) {
      w = { loopRunning: false, target: 1 };
      this.workers.set(threadId, w);
    }
    return w;
  }

  async runDehydrate(threadId: string): Promise<void> {
    const config = entertainmentService.getParsedConfig(threadId);
    if (
      !config ||
      config.mode !== "dehydrate" ||
      config.novel.type !== "file" ||
      config.options.nonNovelSource
    ) {
      return; // not this pipeline
    }
    // The loop sets finalChapterNumber at EOF — once set, the book is fully
    // dehydrated and re-entry is blocked.
    if (entertainmentService.getFinalChapterNumber(threadId) != null) {
      logger.info("runDehydrate skipped — already complete", { threadId });
      return;
    }
    const w = this.workerFor(threadId);
    if (w.loopRunning) {
      logger.info("runDehydrate skipped — loop already running", { threadId });
      return;
    }
    w.loopRunning = true;
    // Fresh abort controller for this run so `stop` can preempt the loop
    // mid-pass. Cleared in `finally` regardless of outcome.
    const abort = new AbortController();
    w.abortController = abort;
    sendInfo("脱水重写已开始", "正在为这本小说脱水重写，请稍候。");
    logger.info("phase 1: dehydrate loop starting", {
      threadId,
      resume: entertainmentService.getConsumedOffset(threadId) > 0,
    });
    try {
      await runDehydrateLoop(threadId, abort.signal);
      if (entertainmentService.getFinalChapterNumber(threadId) != null) {
        sendSuccess(
          i18n.t("entertainment.outlineSucceededTitle"),
          i18n.t("entertainment.outlineSucceededBody"),
        );
      }
      logger.info("runDehydrate complete", {
        threadId,
        finalChapter: entertainmentService.getFinalChapterNumber(threadId),
      });
    } catch (err) {
      logger.error("runDehydrate failed", { threadId, err });
      sendWarning(
        i18n.t("entertainment.outlineFailedTitle"),
        i18n.t("entertainment.outlineFailedBody"),
      );
    } finally {
      w.loopRunning = false;
      if (w.abortController === abort) {
        w.abortController = undefined;
      }
    }
  }

  ensureRange(threadId: string, from: number, to: number): void {
    const w = this.workerFor(threadId);
    w.target = from;
    // Thread-open → resume path: if the book isn't done and the loop isn't
    // running, kick it (it resumes from rawConsumedOffset).
    if (
      entertainmentService.getFinalChapterNumber(threadId) == null &&
      !w.loopRunning
    ) {
      void this.runDehydrate(threadId).catch((err) =>
        logger.error("ensureRange runDehydrate failed", {
          threadId,
          from,
          to,
          err,
        }),
      );
    }
  }

  retryFailed(threadId: string): number {
    const w = this.workerFor(threadId);
    if (
      entertainmentService.getFinalChapterNumber(threadId) == null &&
      !w.loopRunning
    ) {
      void this.runDehydrate(threadId).catch((err) =>
        logger.error("retryFailed runDehydrate failed", { threadId, err }),
      );
    }
    return 0;
  }

  getInfo(threadId: string): WorkerLiveness {
    const w = this.workers.get(threadId);
    if (!w) return { active: false, target: 0, pending: 0, size: 0 };
    return {
      active: w.loopRunning,
      target: w.target,
      pending: 0,
      size: 0,
    };
  }

  getInFlight(_threadId: string): Set<number> {
    // No per-chapter queue — chapters appear as the loop commits them.
    return new Set<number>();
  }

  stop(threadId: string): void {
    const w = this.workers.get(threadId);
    if (!w) return;
    w.abortController?.abort();
    w.abortController = undefined;
    logger.info("stopped in-flight work", { threadId });
  }
}

export const chapteredFileScheduler: ChapteredFilePipeline =
  new ChapteredFileScheduler();
