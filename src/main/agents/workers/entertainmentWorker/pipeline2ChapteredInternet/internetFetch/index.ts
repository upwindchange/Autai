import log from "electron-log/main";
import {
  SessionTabService,
  entertainmentFrontendService,
  entertainmentBackendService,
} from "@/services";
import type { InternetNovel } from "@shared";
import { landOnChapter } from "./phase1Land";
import { extractChapter } from "./phase2Extract";

const logger = log.scope("Dehydrate:InternetFetch");

/**
 * Context injected into every phase agent's tools via `toolsContext`.
 * Carries `threadId` + `chapterNumber` (which chapter the terminal tools write
 * to) alongside the browser `sessionId` + `activeTabId` the existing tools
 * expect — all zero-token (never appears in a prompt). This is the "context
 * API" pattern: data reaches tool business logic without consuming tokens.
 *
 * `blockedDomains` — hostnames the fetch chain has judged DEAD for this thread
 * (paywall/captcha/永久性无法导航 on that site). Held in memory, keyed by
 * threadId, shared across chapters: a site that blocked chapter N is not
 * retried for N+1; the chain moves to a different site instead. Lost on main
 * restart — acceptable: a fresh process re-probes and re-blocks if needed.
 */
export interface InternetFetchContext {
  sessionId: string;
  activeTabId: string;
  threadId: string;
  chapterNumber: number;
  abortSignal?: AbortSignal;
}

// threadId → set of blocked hostnames (see InternetFetchContext above).
const blockedDomains = new Map<string, Set<string>>();

/** Mark a hostname dead for a thread (phase 1's fallback chain). */
export function blockDomainForThread(threadId: string, hostname: string): void {
  let set = blockedDomains.get(threadId);
  if (!set) {
    set = new Set();
    blockedDomains.set(threadId, set);
  }
  set.add(hostname);
  logger.info("domain blocked for thread", { threadId, hostname });
}

/** Hostnames known dead for a thread (empty set when none). */
export function getBlockedDomains(threadId: string): Set<string> {
  return blockedDomains.get(threadId) ?? new Set<string>();
}

/** Drop a thread's blocklist (called when the thread's crawl tab is released). */
export function clearBlockedDomains(threadId: string): void {
  blockedDomains.delete(threadId);
}

export interface FetchChapterOptions {
  threadId: string;
  /**
   * true = force the search/landing path even for N>1. Derived by
   * `fetchInternetChapter` from the chapter's prior status (chapter 1, a
   * retried `error` row, or a mid-book start chapter with no fetched
   * predecessor → re-anchor via search) and threaded down to phase 1, which
   * reads it here.
   */
  useSearch?: boolean;
  abortSignal?: AbortSignal;
}

/**
 * Thrown by phase 1 when it is CONFIDENT chapter N does not exist on any
 * reachable site: an explicit advance-path `abortChapter` (agent believes no
 * next-chapter link / TOC entry exists on the current site) that the TOC
 * fallback then CONFIRMS (a readable TOC with no entry for N). A
 * paywalled/captcha'd TOC never confirms finality; the chain instead marks
 * the site dead and searches for a different one. So when this error
 * surfaces, N-1 was the last chapter. `fetchInternetChapter` catches it and
 * treats it distinctly: sets `finalChapterNumber` to N-1, removes the phantom
 * chapter-N row, releases the crawl tab, reports `"finalChapter"`.
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
  const tabId = sts.getTabsForSession(sessionId)[0];
  if (!tabId) {
    throw new Error(`crawl session ${sessionId} has no tab`);
  }
  // Point the session's active-tab pointer at our crawl tab so split-view
  // visibility (if enabled) tracks it. (Tools target the tab via the
  // `activeTabId` we pass in toolsContext, not this pointer.)
  const state = sts.getSessionTabState(sessionId);
  if (state) state.activeTabId = tabId;
  return tabId;
}

/** Release the crawl tab at book end (FinalChapterError) + the site blocklist. */
async function destroyCrawlTab(
  sessionId: string,
  threadId: string,
): Promise<void> {
  const sts = SessionTabService.getInstance();
  await sts.destroyAllTabs(sessionId);
  clearBlockedDomains(threadId);
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
  // errored chapter re-anchors via search; chapter 1 always searches. A start
  // chapter >1 with no fetched predecessor must ALSO search — there is no
  // chapter N-1 URL in the DB to advance from (the crawl begins mid-book).
  const prior = entertainmentFrontendService.getSourceChapter(
    threadId,
    chapterNumber,
  );
  const useSearch =
    chapterNumber === 1 ||
    prior?.status === "error" ||
    (novel.startChapterNumber === chapterNumber &&
      entertainmentFrontendService.getSourceChapter(threadId, chapterNumber - 1)
        ?.status !== "fetched");
  entertainmentBackendService.markSourceChapterFetching({
    threadId,
    chapterNumber,
  });

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
    entertainmentBackendService.updateSourceChapter(threadId, chapterNumber, {
      status: "fetched",
    });
    return "fetched";
  } catch (err) {
    if (err instanceof FinalChapterError) {
      await destroyCrawlTab(sessionId, threadId); // book done — release tab + blocklist
      entertainmentBackendService.setFinalChapterNumber(
        threadId,
        chapterNumber - 1,
      );
      entertainmentBackendService.deleteSourceChapter(threadId, chapterNumber);
      logger.info("reached final chapter", {
        threadId,
        final: chapterNumber - 1,
      });
      return "finalChapter";
    }
    logger.error("source acquire failed", { threadId, chapterNumber, err });
    entertainmentBackendService.updateSourceChapter(threadId, chapterNumber, {
      status: "error",
    });
    return "error";
  }
}
