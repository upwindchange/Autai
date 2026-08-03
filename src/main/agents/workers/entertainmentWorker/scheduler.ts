/**
 * Entertainment worker scheduler — the single trigger layer for all background
 * chapter workers. Process-local, driven by REST events + thread-open. No
 * external queue, no polling, no persisted stop flag.
 *
 * One invariant: only the thread the reader cursor points at runs. Switching
 * threads or abandoning aborts the previous thread's runner. The sole
 * exception is the internet wizard's prefetch, which fetches (never rewrites)
 * while the user is still choosing options.
 *
 * Every thread has at most one live runner (tracked in `active`). Each
 * `start*` method aborts any in-flight runner for that thread before starting
 * a fresh one; `resumeOnOpen` is idempotent (no-ops if a runner is already
 * running) because the reader pushes the cursor every poll tick.
 */
import log from "electron-log/main";
import type { InternetNovel } from "@shared";
import {
  entertainmentBackendService,
  entertainmentFrontendService,
} from "@/services";
import { runDehydrateLoop } from "./pipeline1ChapteredFile/dehydrateRunner";
import { fetchInternetChapter } from "./pipeline2ChapteredInternet/internetFetch";
import { rewriteChapter } from "./pipeline2ChapteredInternet/rewriter";

const logger = log.scope("EntertainmentScheduler");

export interface EntertainmentScheduler {
  /** File thread: kick off the dehydrate loop (after the wizard uploads). */
  startFilePipeline(threadId: string): void;
  /** Internet wizard "Fetch & Continue": fetch only, do not rewrite. */
  startInternetPrefetch(threadId: string): void;
  /** Internet thread: fetch + rewrite together (started when reader opens). */
  startInternetPipeline(threadId: string): void;
  /** Abort a thread's in-flight runner (thread switch / abandon / Stop). */
  stopThread(threadId: string): void;
  /** Resume unfinished work on open; picks the pipeline from stored config. */
  resumeOnOpen(threadId: string): void;
  /** Re-enqueue errored chapters. Returns how many were reprocessed. */
  retryFailed(threadId: string): number;
}

class EntertainmentSchedulerImpl implements EntertainmentScheduler {
  /** One live AbortController per thread; presence ⇒ a runner is in flight. */
  private active = new Map<string, AbortController>();

  // --- file pipeline -------------------------------------------------------

  startFilePipeline(threadId: string): void {
    this.stopThread(threadId);
    // null final ⇒ the loop hasn't reached EOF yet.
    const final = entertainmentFrontendService.getFinalChapterNumber(threadId);
    if (final != null) {
      logger.info("startFilePipeline skipped — already at EOF", {
        threadId,
        finalChapter: final,
      });
      return;
    }
    logger.info("startFilePipeline", { threadId });
    this.run(threadId, (signal) => runDehydrateLoop(threadId, signal));
  }

  // --- internet prefetch (fetch only) --------------------------------------

  startInternetPrefetch(threadId: string): void {
    this.stopThread(threadId);
    const config = entertainmentFrontendService.getParsedConfig(threadId);
    if (!config || config.novel.type !== "internet") {
      logger.warn("startInternetPrefetch skipped — no internet config", {
        threadId,
        hasConfig: !!config,
      });
      return;
    }
    const novel = config.novel;
    logger.info("startInternetPrefetch (fetch only)", { threadId });
    this.run(threadId, (signal) =>
      this.fetchLoop(threadId, novel, signal, { rewrite: false }),
    );
  }

  startInternetPipeline(threadId: string): void {
    this.stopThread(threadId);
    const config = entertainmentFrontendService.getParsedConfig(threadId);
    if (!config || config.novel.type !== "internet") {
      logger.warn("startInternetPipeline skipped — no internet config", {
        threadId,
        hasConfig: !!config,
      });
      return;
    }
    const novel = config.novel;
    logger.info("startInternetPipeline (fetch + rewrite)", { threadId });
    this.run(threadId, (signal) =>
      this.fetchLoop(threadId, novel, signal, { rewrite: true }),
    );
  }

  // --- stop / resume / retry ----------------------------------------------

  stopThread(threadId: string): void {
    const controller = this.active.get(threadId);
    if (!controller) return;
    controller.abort();
    this.active.delete(threadId);
    logger.info("thread stopped", { threadId });
  }

  resumeOnOpen(threadId: string): void {
    // Idempotent: the reader pushes the cursor every poll tick + on every
    // chapter nav. A runner already in flight ⇒ nothing to do (silent — this
    // is the common case on every poll, logging it would spam).
    if (this.active.has(threadId)) return;

    const config = entertainmentFrontendService.getParsedConfig(threadId);
    if (!config) {
      logger.warn("resumeOnOpen skipped — no config", { threadId });
      return;
    }
    const final = entertainmentFrontendService.getFinalChapterNumber(threadId);

    if (config.novel.type === "file") {
      const hasRaw = entertainmentBackendService.getRawNovelText(threadId);
      const offset = entertainmentBackendService.getConsumedOffset(threadId);
      // Only resume a file thread that has work left (no final + something to chew).
      if (final != null) {
        logger.info("resumeOnOpen (file) — already at EOF", {
          threadId,
          finalChapter: final,
        });
      } else if (hasRaw || offset > 0) {
        logger.info("resumeOnOpen (file) — resuming dehydrate loop", {
          threadId,
          hasRaw,
          offset,
        });
        this.startFilePipeline(threadId);
      } else {
        logger.info("resumeOnOpen (file) — no raw text, nothing to resume", {
          threadId,
        });
      }
      return;
    }

    // internet: only auto-run fetch+rewrite if the user has previously pressed
    // Start (≥1 rewrite row). A zero-rewrite thread that only has fetched
    // sources (prefetch ran, Start never pressed) keeps fetching more chapters
    // but does NOT rewrite — the user hasn't committed options yet.
    const rewritten = entertainmentBackendService.countRewrittenChapters(threadId);
    if (rewritten > 0) {
      logger.info("resumeOnOpen (internet) — fetch + rewrite", {
        threadId,
        rewrittenCount: rewritten,
        atEOF: final != null,
      });
      this.startInternetPipeline(threadId);
    } else {
      logger.info("resumeOnOpen (internet) — fetch only (no Start yet)", {
        threadId,
        rewrittenCount: 0,
      });
      this.startInternetPrefetch(threadId);
    }
  }

  retryFailed(threadId: string): number {
    const config = entertainmentFrontendService.getParsedConfig(threadId);
    if (!config) {
      logger.warn("retryFailed skipped — no config", { threadId });
      return 0;
    }

    // File threads re-run the whole loop (it self-continues from offset).
    if (config.novel.type === "file") {
      logger.info("retryFailed (file) — restarting dehydrate loop", {
        threadId,
      });
      this.startFilePipeline(threadId);
      return 0;
    }

    const progress = entertainmentFrontendService.listChapterProgress(threadId);
    const failed = progress.filter(
      (c) => c.sourceStatus === "error" || c.rewriteStatus === "error",
    );
    if (failed.length === 0) {
      logger.info("retryFailed — no errored chapters", { threadId });
      return 0;
    }

    logger.info("retryFailed (internet) — re-enqueuing", {
      threadId,
      failedChapters: failed.map((c) => c.chapterNumber),
      count: failed.length,
    });

    // Re-enqueue: the pipeline aborts the in-flight runner and starts a fresh
    // one that walks errored chapters one at a time.
    this.stopThread(threadId);
    const controller = new AbortController();
    this.active.set(threadId, controller);
    const signal = controller.signal;
    const novel = config.novel;
    const options = config.options;

    void (async () => {
      try {
        for (const c of failed) {
          if (signal.aborted) {
            logger.info("retry loop aborted", { threadId, chapterNumber: c.chapterNumber });
            break;
          }
          // Source errored (or never fetched) ⇒ re-fetch, then rewrite.
          if (c.sourceStatus === "error") {
            const outcome = await fetchInternetChapter(novel, c.chapterNumber, {
              threadId,
              abortSignal: signal,
            });
            if (outcome === "error") {
              logger.warn("retry re-fetch failed", {
                threadId,
                chapterNumber: c.chapterNumber,
              });
              continue;
            }
            if (outcome === "finalChapter") {
              logger.info("retry re-fetch hit final chapter", {
                threadId,
                chapterNumber: c.chapterNumber,
              });
              continue;
            }
          }
          // Rewrite errored (or source is fresh) ⇒ re-rewrite.
          await rewriteChapter(threadId, c.chapterNumber, options, signal);
        }
      } catch (err) {
        if (!signal.aborted) logger.error("retry loop failed", { threadId, err });
      } finally {
        if (this.active.get(threadId) === controller) {
          this.active.delete(threadId);
          logger.info("retryFailed complete", { threadId });
        }
      }
    })();

    return failed.length;
  }

  // --- internals -----------------------------------------------------------

  /**
   * Spawn a runner for a thread under a fresh AbortController. The controller
   * is removed from `active` when the runner settles (success, failure, or
   * abort). Caller MUST have already stopped any prior runner.
   */
  private run(
    threadId: string,
    runner: (signal: AbortSignal) => Promise<void>,
  ): void {
    const controller = new AbortController();
    this.active.set(threadId, controller);
    void (async () => {
      try {
        await runner(controller.signal);
        logger.info("runner settled", { threadId });
      } catch (err) {
        if (!controller.signal.aborted) {
          logger.error("runner failed", { threadId, err });
        } else {
          logger.info("runner aborted", { threadId });
        }
      } finally {
        // Only delete if it's still ours — a newer start may have replaced it.
        if (this.active.get(threadId) === controller) {
          this.active.delete(threadId);
        }
      }
    })();
  }

  /**
   * Fetch chapters strictly serially (one crawl tab is reused across chapters;
   * two concurrent fetchers corrupt it). With `rewrite: true`, rewrite each
   * chapter right after it fetches. Stops on final chapter, error, or abort.
   */
  private async fetchLoop(
    threadId: string,
    novel: InternetNovel,
    signal: AbortSignal,
    opts: { rewrite: boolean },
  ): Promise<void> {
    const config = entertainmentFrontendService.getParsedConfig(threadId);
    if (!config) {
      logger.warn("fetchLoop — config vanished", { threadId });
      return;
    }
    logger.info("fetchLoop start", {
      threadId,
      rewrite: opts.rewrite,
    });
    let n = 1;
    while (!signal.aborted) {
      const final = entertainmentFrontendService.getFinalChapterNumber(threadId);
      if (final != null) {
        logger.info("fetchLoop — reached EOF", { threadId, finalChapter: final });
        break;
      }
      const prior = entertainmentFrontendService.getSourceChapter(threadId, n);
      if (!prior || prior.status !== "fetched") {
        const outcome = await fetchInternetChapter(novel, n, {
          threadId,
          abortSignal: signal,
        });
        if (outcome === "finalChapter") {
          logger.info("fetchLoop — fetch reported final chapter", {
            threadId,
            atChapter: n,
          });
          break;
        }
        if (outcome === "error") {
          logger.warn("fetchLoop — fetch errored, stopping", {
            threadId,
            atChapter: n,
          });
          break;
        }
      }
      if (opts.rewrite) {
        // Skip chapters already rewritten (idempotent resume).
        const existing =
          entertainmentFrontendService.getRewrittenChapter(threadId, n);
        if (!existing || existing.status === "error") {
          await rewriteChapter(threadId, n, config.options, signal);
        }
      }
      n++;
    }
    if (signal.aborted) {
      logger.info("fetchLoop aborted", { threadId, lastChapter: n });
    } else {
      logger.info("fetchLoop done", { threadId, lastChapter: n });
    }
  }
}

export const entertainmentScheduler: EntertainmentScheduler =
  new EntertainmentSchedulerImpl();
