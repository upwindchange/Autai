/**
 * Pipeline 3 — non-chaptered internet sources (`nonNovelSource: true` +
 * `novel.type: "internet"`). The source is ONE continuous piece (a long post,
 * an article, an email thread): the reader never chapter-splits it. The
 * pipeline acquires the whole page into a single `source_chapters` row
 * (`chapterNumber = 1`, `finalChapterNumber = 1`) and rewrites it as exactly
 * ONE chapter via the shared chapter rewriter (`pipeline2ChapteredInternet/
 * rewriter` → `rewriteChapter`). Runs once — no chapter loop.
 */
import log from "electron-log/main";
import type { InternetNovel } from "@shared";
import {
  entertainmentBackendService,
  entertainmentFrontendService,
  threadIntelligenceService,
} from "@/services";
import { rewriteChapter } from "../pipeline2ChapteredInternet/rewriter";
import { fetchSinglePage } from "./fetchSinglePage";

const logger = log.scope("Dehydrate:Pipeline3");

export { fetchSinglePage };

/**
 * Ensure source row 1 is fetched (skip if already `"fetched"` — a row stuck in
 * `"fetching"` from a crash mid-fetch is treated as not-fetched and refetched).
 * On a fresh successful fetch set `finalChapterNumber = 1` (the book has
 * exactly one chapter) and fire-and-forget thread enrichment (title + tags —
 * the deterministic title from applyConfig is the instant placeholder this
 * refines).
 */
async function ensureFetched(
  novel: InternetNovel,
  threadId: string,
  signal: AbortSignal,
): Promise<"fetched" | "error"> {
  if (
    entertainmentFrontendService.getSourceChapter(threadId, 1)?.status ===
    "fetched"
  ) {
    return "fetched";
  }
  const outcome = await fetchSinglePage(novel, threadId, signal);
  if (outcome === "fetched") {
    entertainmentBackendService.setFinalChapterNumber(threadId, 1);
    threadIntelligenceService
      .enrichEntertainmentThreadFromDb(threadId)
      .catch((err) => {
        logger.warn("entertainment enrichment failed", { threadId, err });
      });
  }
  return outcome;
}

/**
 * Non-chaptered internet pipeline: acquire the single page, then (with
 * `rewrite: true`) rewrite it as one chapter via the shared rewriter. Runs
 * once — no chapter loop. Idempotent: skips fetch/rewrite stages whose rows
 * are already terminal-done.
 */
export async function runSinglePagePipeline(
  threadId: string,
  novel: InternetNovel,
  signal: AbortSignal,
  opts: { rewrite: boolean },
): Promise<void> {
  const config = entertainmentFrontendService.getParsedConfig(threadId);
  if (!config) {
    logger.warn("runSinglePagePipeline — config vanished", { threadId });
    return;
  }

  // Fast path: the single chapter is fully done — nothing to do.
  const final = entertainmentFrontendService.getFinalChapterNumber(threadId);
  const rewritten = entertainmentFrontendService.getRewrittenChapter(
    threadId,
    1,
  );
  if (final === 1 && rewritten?.status === "rewritten") return;

  logger.info("runSinglePagePipeline", { threadId, rewrite: opts.rewrite });

  const outcome = await ensureFetched(novel, threadId, signal);
  if (outcome === "error") return; // row already marked error by fetchSinglePage

  if (opts.rewrite) {
    // Skip an already-done rewrite (idempotent resume); "to_be_continued" is
    // done-adjacent for a single-piece source and is likewise left alone.
    if (
      rewritten &&
      (rewritten.status === "rewritten" ||
        rewritten.status === "to_be_continued")
    ) {
      return;
    }
    await rewriteChapter(threadId, 1, config.options, signal);
  }
}
