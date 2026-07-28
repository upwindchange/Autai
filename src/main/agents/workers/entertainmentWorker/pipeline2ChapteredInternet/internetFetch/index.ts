import log from "electron-log/main";
import { SessionTabService, entertainmentService } from "@/services";
import type { InternetNovel } from "@shared";
import { landOnChapter } from "./phase1Land";
import { extractChapter } from "./phase2Extract";

const logger = log.scope("Dehydrate:InternetFetch");

/**
 * Context injected into every phase agent's tools via `experimental_context`.
 * Carries `threadId` + `chapterNumber` (which chapter the terminal tools write
 * to) alongside the browser `sessionId` + `activeTabId` the existing tools
 * expect — all zero-token (never appears in a prompt). This is the "context
 * API" pattern: data reaches tool business logic without consuming tokens.
 */
export interface InternetFetchContext {
  sessionId: string;
  activeTabId: string;
  threadId: string;
  chapterNumber: number;
  abortSignal?: AbortSignal;
}

export interface FetchChapterOptions {
  threadId: string;
  /**
   * true = force the search/landing path even for N>1. No longer caller-supplied
   * — `fetchInternetChapter` derives it from the chapter's prior status
   * (chapter 1, or a retried `error` row → re-anchor via search) and threads it
   * down to phase 1/phase 2, which still read it from here.
   */
  useSearch?: boolean;
  abortSignal?: AbortSignal;
}

/**
 * Thrown by phase 1's anchor path when it cannot find chapter N (no
 * next-chapter link AND no table-of-contents entry) — meaning chapter N-1 was
 * the LAST chapter of the book. `fetchInternetChapter` catches this and treats
 * it distinctly from a generic acquisition error: it sets `finalChapterNumber`
 * to N-1, removes the phantom chapter-N row, releases the crawl tab, and
 * reports `"finalChapter"` (instead of marking the chapter `error`).
 */
export class FinalChapterError extends Error {
  constructor(message = "Reached the final chapter") {
    super(message);
    this.name = "FinalChapterError";
  }
}

/**
 * Find-or-create the thread's single persistent crawl tab. Stateless — no Map,
 * no manager: `activateSession` creates the session + an initial tab on first
 * use, and the tab is reused across chapters (carried phase 1 → phase 2 → next
 * chapter) until `destroyCrawlTab` runs at book end. Functional regardless of
 * split-view visibility: the WebContentsView + CDP/DOM services work hidden.
 */
async function ensureCrawlTab(sessionId: string): Promise<string> {
  const sts = SessionTabService.getInstance();
  await sts.activateSession(sessionId);
  const tabs = sts.getTabsForSession(sessionId);
  const tabId = tabs[0];
  // Point the session's active-tab pointer at our crawl tab so split-view
  // visibility (if enabled) tracks it. (Tools target the tab via the
  // `activeTabId` we pass in experimental_context, not this pointer.)
  const state = sts.getSessionTabState(sessionId);
  if (state) state.activeTabId = tabId;
  return tabId;
}

/** Release the crawl tab at book end (FinalChapterError). */
async function destroyCrawlTab(sessionId: string): Promise<void> {
  const sts = SessionTabService.getInstance();
  await sts.destroyAllTabs(sessionId);
}

/** Terminal status the fetch reports back to its caller. */
export type FetchOutcome = "fetched" | "finalChapter" | "error";

/**
 * Acquire one chapter of an internet novel and own its `source_chapters` row
 * lifecycle end to end. Marks the row `"fetching"` up front (inserting a fresh
 * row or resetting a stale one), derives `useSearch` from the prior status
 * (chapter 1, or a retried `error` row → re-anchor via search), then runs
 * phase 1 (lands + persists the real URL) and phase 2 (extracts the prose).
 * Both phases run as agent loops whose terminal tools write `url` + `content`
 * directly to `source_chapters`. The crawl tab is created once per thread and
 * carried across chapters.
 *
 * Returns the status for the caller to branch on — it never throws for
 * expected outcomes:
 * - `"fetched"` — source acquired; the caller may proceed to rewrite.
 * - `"finalChapter"` — phase 1 found no chapter N (N-1 was the last): sets
 *   `finalChapterNumber` to N-1, drops the phantom row, releases the crawl tab.
 * - `"error"` — any other acquisition failure: marks the row `error`.
 */
export async function fetchInternetChapter(
  novel: InternetNovel,
  chapterNumber: number,
  options: FetchChapterOptions,
): Promise<FetchOutcome> {
  const threadId = options.threadId;

  // Own the source-row lifecycle + derive the landing path. A retry of an
  // errored chapter re-anchors via search; chapter 1 always searches.
  const prior = entertainmentService.getSourceChapter(threadId, chapterNumber);
  const useSearch = chapterNumber === 1 || prior?.status === "error";
  if (!prior) {
    entertainmentService.insertSourceChapter({
      threadId,
      chapterNumber,
      status: "fetching",
    });
  } else {
    entertainmentService.updateSourceChapter(threadId, chapterNumber, {
      status: "fetching",
    });
  }

  const sessionId = `ent-fetch-${threadId}`;
  const tabId = await ensureCrawlTab(sessionId);
  const ctx: InternetFetchContext = {
    sessionId,
    activeTabId: tabId,
    threadId,
    chapterNumber,
    abortSignal: options.abortSignal,
  };
  logger.info("fetch chapter", {
    threadId,
    chapterNumber,
    useSearch,
  });

  try {
    await landOnChapter(novel, ctx, { ...options, useSearch });
    await extractChapter(novel, ctx);
    entertainmentService.updateSourceChapter(threadId, chapterNumber, {
      status: "fetched",
    });
    return "fetched";
  } catch (err) {
    if (err instanceof FinalChapterError) {
      await destroyCrawlTab(sessionId); // book done — release the crawl tab
      entertainmentService.setFinalChapterNumber(threadId, chapterNumber - 1);
      entertainmentService.deleteSourceChapter(threadId, chapterNumber);
      logger.info("reached final chapter", {
        threadId,
        final: chapterNumber - 1,
      });
      return "finalChapter";
    }
    logger.error("source acquire failed", { threadId, chapterNumber, err });
    entertainmentService.updateSourceChapter(threadId, chapterNumber, {
      status: "error",
    });
    return "error";
  }
}
