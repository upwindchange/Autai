import log from "electron-log/main";
import {
  SessionTabService,
  entertainmentFrontendService,
  entertainmentBackendService,
} from "@/services";
import type { InternetNovel } from "@shared";
import { landOnChapter, clearSearchCandidatePools } from "./phase1Land";
import { extractChapter, SiteDeadendError } from "./phase2Extract";

const logger = log.scope("Dehydrate:InternetFetch");

/**
 * Context injected into every phase agent's tools via `toolsContext`.
 * Carries `threadId` + `chapterNumber` (which chapter the terminal tools write
 * to) alongside the browser `sessionId` + `activeTabId` the existing tools
 * expect — all zero-token (never appears in a prompt). This is the "context
 * API" pattern: data reaches tool business logic without consuming tokens.
 *
 * `blockedSites` — hostnames the fetch chain has judged DEAD for this thread,
 * persisted in `entertainment_configs.blocked_sites` as hostname → reason
 * (paywall / captcha / wrong-content / …) via `entertainmentBackendService`.
 * Shared across chapters AND across restarts: a site that dead-ended chapter
 * N is not re-crawled for N+1 or after a Redo-failed re-run.
 */
export interface InternetFetchContext {
  sessionId: string;
  activeTabId: string;
  threadId: string;
  chapterNumber: number;
  abortSignal?: AbortSignal;
}

/** Hostnames known dead for a thread (empty record when none). */
export function getBlockedDomains(threadId: string): ReadonlySet<string> {
  return new Set(
    Object.keys(entertainmentBackendService.getBlockedSites(threadId)),
  );
}

/** Mark a hostname dead for a thread with a reason (idempotent). */
export function blockDomainForThread(
  threadId: string,
  hostname: string,
  reason = "unusable",
): void {
  entertainmentBackendService.blockSite(threadId, hostname, reason);
}

/** Drop a thread's blocklist (called when the thread's crawl tab is released). */
export function clearBlockedDomains(threadId: string): void {
  entertainmentBackendService.clearBlockedSites(threadId);
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
  /**
   * URLs already probed (judged / navigated) during the CURRENT fetch —
   * hoisted here by the site-rotation loop so a rotation's re-landing pass
   * never re-judges a candidate it already rejected. Accumulated across
   * rotation attempts within one `fetchInternetChapter` call.
   */
  probedUrls?: Set<string>;
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
  clearSearchCandidatePools(threadId);
}

/** Terminal status the fetch reports back to its caller. */
export type FetchOutcome = "fetched" | "finalChapter" | "error";

/**
 * Max distinct sites one chapter fetch will fully land + extract on before
 * declaring the chapter unreadable. A search returns 5-8 candidates but only
 * 3-5 distinct organic reading sites; three phase-2 dead ends is a strong
 * signal the book isn't freely readable anywhere mainstream. Blocked sites
 * persist, so later chapters (or a Redo-failed retry) start where this fetch
 * left off instead of re-paying for the same dead sites.
 */
const MAX_LANDED_SITES_PER_FETCH = 3;

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
    // Site rotation: land + extract on one distinct site at a time. A phase-2
    // dead end (paywall discovered mid-extraction, etc.) marks that site dead
    // and re-runs landing with the expanded blocklist, so the next attempt
    // lands on a DIFFERENT site. `probedUrls` survives across attempts so no
    // candidate is judged twice in one fetch.
    const probedUrls = new Set<string>();
    const landedHosts = new Set<string>();
    let forceSearch = useSearch;
    for (;;) {
      if (options.abortSignal?.aborted) throw new Error("aborted");
      await landOnChapter(novel, ctx, {
        ...options,
        useSearch: forceSearch,
        probedUrls,
      });
      // A rotation must land on a DIFFERENT site: the advance path would
      // re-advance from the same (now blocklisted) site's tab, so every
      // attempt after the first anchors via search with the grown blocklist.
      forceSearch = true;
      const landedUrl =
        entertainmentFrontendService.getSourceChapter(threadId, chapterNumber)
          ?.url ?? "";
      const landedHost = hostnameOf(landedUrl);
      if (landedHost) landedHosts.add(landedHost);

      try {
        await extractChapter(novel, ctx);
        entertainmentBackendService.updateSourceChapter(threadId, chapterNumber, {
          status: "fetched",
        });
        return "fetched";
      } catch (err) {
        // A typed site dead end (wall / unreadable content on the landed
        // site) rotates to the next site; any other phase-2 failure is a
        // genuine error.
        if (!(err instanceof SiteDeadendError)) throw err;
        if (!landedHost) throw err; // no URL captured — cannot blocklist
        blockDomainForThread(threadId, landedHost, err.reason);
        logger.info("site dead-ended during extraction; rotating", {
          threadId,
          chapterNumber,
          host: landedHost,
          reason: err.reason,
          landedSites: landedHosts.size,
        });
        if (landedHosts.size >= MAX_LANDED_SITES_PER_FETCH) {
          throw new Error(
            `chapter ${chapterNumber} unreadable: ${landedHosts.size} sites dead-ended (${[...landedHosts].map((h) => `${h}: ${entertainmentBackendService.getBlockedSites(threadId)[h] ?? "?"}`).join("; ")})`,
          );
        }
        // Rotation: the next landOnChapter pass re-searches with the expanded
        // blocklist and cannot land on any host in `landedHosts`.
      }
    }
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
    // An aborted runner (thread switch / Stop / wizard restart, or a new
    // runner replacing this one) is NOT a source failure. Skip the "error"
    // write so the row stays "fetching" and the next runner re-fetches it
    // instead of it scarring "error" and requiring a manual Redo-failed.
    if (options.abortSignal?.aborted) {
      logger.info("fetch aborted (runner stopped)", {
        threadId,
        chapterNumber,
      });
      return "error";
    }
    logger.error("source acquire failed", { threadId, chapterNumber, err });
    entertainmentBackendService.updateSourceChapter(threadId, chapterNumber, {
      status: "error",
    });
    return "error";
  }
}

/** Hostname of a URL, or null when unparseable. */
function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}
