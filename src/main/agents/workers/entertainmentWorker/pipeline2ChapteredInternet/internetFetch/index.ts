import log from "electron-log/main";
import { entertainmentBackendService } from "@/services";
import type { InternetNovel } from "@shared";

const logger = log.scope("Dehydrate:InternetFetch");

/** Terminal status the fetch reports back to its caller (the scheduler). */
export type FetchOutcome = "fetched" | "finalChapter" | "error";

/**
 * Chaptered internet fetch — acquire chapter N's prose into `source_chapters`.
 *
 * The fetcher implementation was removed for a from-scratch rewrite. Until it
 * returns, this owns the source-row lifecycle exactly as the contract
 * requires on failure: mark the row `fetching`, then immediately `error`.
 * The scheduler loop stops cleanly on `"error"`, and `retryFailed` can
 * re-enqueue the chapter once the real implementation exists.
 *
 * The full IO contract this function must honor — inputs (config, DB reads,
 * AbortSignal), outputs (source_chapters writes, events, FetchOutcome
 * semantics), and intermediate state (`blocked_sites`, crawl tab, search
 * sessions) — is documented in `docs/entertainment-internet-fetch-io.md`.
 */
export async function fetchInternetChapter(
  _novel: InternetNovel,
  chapterNumber: number,
  options: { threadId: string; abortSignal?: AbortSignal },
): Promise<FetchOutcome> {
  const { threadId } = options;
  logger.warn("chaptered internet fetch not implemented (rewrite pending)", {
    threadId,
    chapterNumber,
  });
  entertainmentBackendService.markSourceChapterFetching({
    threadId,
    chapterNumber,
  });
  entertainmentBackendService.updateSourceChapter(threadId, chapterNumber, {
    status: "error",
  });
  return "error";
}
