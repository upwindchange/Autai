/**
 * Chaptered internet fetch — acquire chapter N's prose into `source_chapters`.
 *
 * A deterministic code orchestrator driving five LLM agents (search entry →
 * toc judgment → target-chapter landing → extraction → advance/finality):
 * the CODE navigates, probes every landing for wall markers in code, owns
 * all budgets, and blacklists-and-rotates the site the moment any trace of
 * a human-intervention wall (login / paywall / VIP badge ANYWHERE on the
 * site / captcha / age gate) appears. IO contract:
 * docs/story-internet-fetch-io.md.
 *
 * Site anchoring: the first site proven to host our book is persisted as
 * `{ host, bookUrl, tocUrl }` (story_configs.site_anchors) so later
 * chapters skip search entirely; anchors are cleared when the site dies.
 *
 * The override path (options.overrideUrl — the reader's chapter-link button)
 * bypasses all discovery: navigate the user's URL, probe, extract, save. No
 * verification of chapter identity — the user vouches this IS chapter N.
 */

import log from "electron-log/main";
import { i18n } from "@/i18n";
import { sendWarning } from "@/utils/messageUtils";
import type { InternetNovel } from "@shared";
import {
  storyBackendService,
  storyFrontendService,
  SessionTabService,
  TabControlService,
} from "@/services";
import type { SiteAnchors } from "@/services/story/backendService";
import type { LandingRecoveryInput } from "./pure";
import { runBookSearch, clearSearchCache } from "./searchEntry";
import {
  findTocAgent,
  targetChapterAgent,
  advanceAgent,
  extractChapterAgent,
  finalityProofAgent,
  type Ctx,
} from "./agents";
import { runDomWallProbe } from "./wallGuard";
import { requestWallHelp } from "./wallGate";

const logger = log.scope("Dehydrate:InternetFetch");

/** Terminal status the fetch reports back to its caller (the scheduler). */
export type FetchOutcome = "fetched" | "finalChapter" | "error";

/** Hard per-chapter wall clock: a dragging site never blocks the book. */
const CHAPTER_DEADLINE_MS = 10 * 60_000;
/** Distinct hosts one chapter may burn (search + rotation budget). */
const MAX_HOSTS_PER_CHAPTER = 3;
/** target-landing attempts per site before it earns "dead-end:landing-failed". */
const MAX_LANDING_RETRIES = 2;
/** Below this the "extracted prose" is chrome/noise, not a chapter. */
const MIN_PROSE_CHARS = 500;

/**
 * Find-or-create the thread's crawl tab (pattern: pipeline3's ensureCrawlTab).
 * `activateSession` creates the session + an initial tab on first use; the
 * tab is reused across chapters and released at book end.
 */
async function ensureCrawlTab(sessionId: string): Promise<string> {
  const sts = SessionTabService.getInstance();
  await sts.activateSession(sessionId);
  const tabId = sts.getTabsForSession(sessionId)[0];
  if (!tabId) {
    throw new Error(`crawl session ${sessionId} has no tab`);
  }
  // Point the session's active-tab pointer at our crawl tab so split-view
  // visibility (if enabled) tracks it. Tools target the tab via the
  // `activeTabId` passed in toolsContext, not this pointer.
  const state = sts.getSessionTabState(sessionId);
  if (state) state.activeTabId = tabId;
  return tabId;
}

/** Live post-redirect URL of the crawl tab. */
function liveUrl(activeTabId: string): string {
  const sts = SessionTabService.getInstance();
  return sts.getTab(activeTabId)?.webContents.getURL() ?? "";
}

/** Hostname of a URL, or null when it doesn't parse. */
function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Acquire chapter N of a chaptered internet novel. Never throws for expected
 * outcomes; owns the source-row lifecycle (`fetching` → `fetched`/`error`).
 */
export async function fetchInternetChapter(
  novel: InternetNovel,
  chapterNumber: number,
  options: {
    threadId: string;
    abortSignal?: AbortSignal;
    overrideUrl?: string;
    /** Rung 3 (book search) runs only when true; a declined wall then
     * errors the chapter instead of hunting for another host. */
    webSearchFallback: boolean;
  },
): Promise<FetchOutcome> {
  const { threadId, abortSignal, overrideUrl, webSearchFallback } = options;
  const n = chapterNumber;

  storyBackendService.markSourceChapterFetching({
    threadId,
    chapterNumber: n,
  });

  const sessionId = `story-fetch-${threadId}`;
  let activeTabId: string;
  try {
    activeTabId = await ensureCrawlTab(sessionId);
  } catch (err) {
    logger.error("crawl tab unavailable", { threadId, err });
    storyBackendService.updateSourceChapter(threadId, n, {
      status: "error",
    });
    return "error";
  }
  const ctx: Ctx = {
    sessionId,
    activeTabId,
    threadId,
    chapterNumber: n,
    abortSignal,
  };

  /** Navigate the crawl tab; false when navigation itself fails. */
  const navigate = async (url: string): Promise<boolean> => {
    const tcs = TabControlService.getInstance();
    try {
      await tcs.navigateTo(activeTabId, url);
      return true;
    } catch (err) {
      logger.warn("navigate failed", { threadId, url, err });
      return false;
    }
  };

  /**
   * Blacklist a host (first reason is kept). Every blockSite also drops the
   * anchors when they point at that host — a dead site's anchors are dead
   * weight.
   */
  const blockSite = (host: string, reason: string): void => {
    storyBackendService.blockSite(threadId, host, reason);
    const anchors = storyBackendService.getSiteAnchors(threadId);
    if (anchors && anchors.host === host) {
      storyBackendService.clearSiteAnchors(threadId);
    }
  };
  /** Deterministic wall probe on the current landing (marker or null). */
  const probe = (): Promise<string | null> =>
    runDomWallProbe(ctx).then((marker) => {
      // Diagnostics: the probe's verdict was silent — a hit explains every
      // rotation that never reached an agent.
      logger.debug("wall probe", {
        threadId,
        n,
        url: liveUrl(activeTabId),
        marker,
      });
      return marker;
    });

  // --- override path: user-supplied chapter URL, no verification ---------

  if (overrideUrl) {
    logger.info("override path — user-anchored chapter URL", { threadId, n });
    const pastedHost = hostnameOf(overrideUrl) ?? "";
    if (await navigate(overrideUrl)) {
      // Host truth = the OPENED page (webContents.getURL()), never the
      // pasted string — a wrapper link (engine /goto?url=…) would otherwise
      // blacklist the engine's host when the real site walls.
      const host = hostnameOf(liveUrl(activeTabId)) ?? pastedHost;
      const marker = await probe();
      if (marker != null) {
        if (host) blockSite(host, "wall:vip-markers");
      } else {
        const extracted = await extractChapterAgent(ctx, novel, n);
        if (extracted.kind === "saved") {
          storyBackendService.updateSourceChapter(threadId, n, {
            url: liveUrl(activeTabId),
            status: "fetched",
          });
          if (extracted.content.length >= MIN_PROSE_CHARS) {
            return "fetched";
          }
          if (host) blockSite(host, "dead-end:no-content");
        } else if (extracted.kind === "wall" && host) {
          blockSite(host, extracted.reason);
        }
      }
    }
    if (!abortSignal?.aborted) {
      storyBackendService.updateSourceChapter(threadId, n, {
        status: "error",
      });
    }
    return "error";
  }

  // --- normal path: entry ladder with budgets -----------------------------
  let deadline = Date.now() + CHAPTER_DEADLINE_MS;
  const attemptedHosts = new Set<string>();
  const probedUrls = new Set<string>();
  let anchors: SiteAnchors | null =
    storyBackendService.getSiteAnchors(threadId);
  let recovery: LandingRecoveryInput | null = null;

  /** Live blocklist read (rotation decisions use fresh state). */
  const hostBlocked = (host: string): boolean =>
    host in storyBackendService.getBlockedSites(threadId);

  /** Re-read anchors after any operation that may have cleared them. */
  const readAnchors = (): SiteAnchors | null =>
    storyBackendService.getSiteAnchors(threadId);

  // --- wall gate: ask the reader before blacklisting ----------------------

  /** Host of the wall the user most recently declined to step into (for the
   * rung-3 skip toast; empty until a wall is declined). */
  let lastWallHost = "";
  let userRejectedWall = false;
  /**
   * Park the fetch and ask the reader to pass the wall manually (or skip).
   * "resolved" ⇒ the site is NOT blocked — the caller retries it; the
   * 10-minute deadline freezes while parked so a step-in never eats budget.
   */
  const gate = async (
    host: string,
    reason: string,
  ): Promise<"resolved" | "rejected"> => {
    const t0 = Date.now();
    const verdict = await requestWallHelp({
      threadId,
      chapterNumber: n,
      sessionId,
      host,
      reason,
      signal: abortSignal,
      probeNow: () => probe(),
    });
    deadline += Date.now() - t0;
    if (verdict === "rejected") {
      userRejectedWall = true;
      lastWallHost = host;
    }
    return verdict;
  };

  /**
   * One extract pass (with its single built-in retry on a transient
   * failure), no wall gate. "saved-short" = prose saved but below
   * MIN_PROSE_CHARS — the caller treats it as a dead end like "dead-end".
   */
  const runExtract = async (): Promise<
    "fetched" | { wall: string } | "dead-end" | "saved-short"
  > => {
    let extracted = await extractChapterAgent(ctx, novel, n);
    if (extracted.kind === "failed") {
      // One retry, then the site is a dead end for this chapter.
      extracted = await extractChapterAgent(ctx, novel, n);
    }
    if (extracted.kind === "wall") return { wall: extracted.reason };
    if (extracted.kind === "failed") return "dead-end";
    storyBackendService.updateSourceChapter(threadId, n, {
      url: liveUrl(activeTabId),
      status: "fetched",
    });
    if (extracted.content.length < MIN_PROSE_CHARS) return "saved-short";
    return "fetched";
  };

  /**
   * Extract on the current landing. Returns the fetch outcome when the
   * chapter is safely saved, or null when the site was rotated (caller
   * continues the ladder). Handles the one extract retry and the
   * no-content dead-ends; a WALL is first offered to the reader via the
   * gate and the extract re-run once (a second wall blocks + rotates).
   * `host` is the landing host; every block re-derives from the OPENED page
   * (the extract agent may navigate).
   */
  const extractHere = async (host: string): Promise<FetchOutcome | null> => {
    // Block/rotate against the page the verdict was actually made on.
    const blockHere = (reason: string): void =>
      blockSite(hostnameOf(liveUrl(activeTabId)) ?? host, reason);
    let verdict = await runExtract();
    if (typeof verdict !== "string") {
      const openedHost = hostnameOf(liveUrl(activeTabId)) ?? host;
      if ((await gate(openedHost, verdict.wall)) === "rejected") {
        blockHere(verdict.wall);
        return null;
      }
      verdict = await runExtract(); // reader passed the wall — retry ONCE
      if (typeof verdict !== "string") {
        blockHere(verdict.wall);
        return null;
      }
    }
    if (verdict === "dead-end" || verdict === "saved-short") {
      blockHere("dead-end:no-content");
      return null;
    }
    return verdict;
  };

  /** Book-end cleanup: release the crawl tab + all per-book rotation state. */
  const finishBook = async (): Promise<void> => {
    const sts = SessionTabService.getInstance();
    await sts.destroyAllTabs(sessionId).catch(() => {});
    storyBackendService.clearBlockedSites(threadId);
    storyBackendService.clearSiteAnchors(threadId);
    clearSearchCache(threadId);
  };

  ladder: while (true) {
    if (abortSignal?.aborted) break ladder;
    if (Date.now() > deadline) {
      logger.warn("chapter deadline exceeded", { threadId, n });
      break ladder;
    }

    // --- rung 1: advance from chapter n-1's saved page --------------------
    const prev = storyFrontendService.getSourceChapter(threadId, n - 1);
    const prevUrl = prev?.url ?? null;
    const savedHost = prevUrl ? hostnameOf(prevUrl) : null;
    if (prevUrl) {
      const blockedReason =
        savedHost ?
          storyBackendService.getBlockedSites(threadId)[savedHost]
        : undefined;
      if (!savedHost || blockedReason != null) {
        logger.debug("rung1 skipped — previous host unusable", {
          threadId,
          n,
          prevUrl,
          host: savedHost,
          blockedReason: blockedReason ?? null,
        });
      }
    } else {
      logger.debug("rung1 skipped — no previous chapter url", {
        threadId,
        n,
      });
    }
    if (prevUrl && savedHost && !hostBlocked(savedHost)) {
      attemptedHosts.add(savedHost);
      if (await navigate(prevUrl)) {
        // Saved urls are post-redirect truth, but a site may have started
        // redirecting since; the OPENED page is the host that gets judged.
        const prevHost = hostnameOf(liveUrl(activeTabId)) ?? savedHost;
        const marker = await probe();
        if (marker != null) {
          if ((await gate(prevHost, "wall:" + marker)) === "resolved") {
            continue ladder; // user passed it — same site retried
          }
          blockSite(prevHost, "wall:" + marker);
          continue ladder;
        }
        const result = await advanceAgent(ctx, novel, n, prevUrl);
        if (result.kind === "landed") {
          const outcome = await extractHere(prevHost);
          if (outcome != null) return outcome;
          anchors = readAnchors();
          continue ladder;
        }
        if (result.kind === "wall") {
          const wallHost = hostnameOf(liveUrl(activeTabId)) ?? prevHost;
          if ((await gate(wallHost, result.reason)) === "resolved") {
            continue ladder; // user passed it — same site retried
          }
          blockSite(wallHost, result.reason);
          continue ladder;
        }
        if (result.kind === "no-next") {
          // Prove finality before declaring the book finished. Prefer the
          // anchored toc; otherwise the agent follows the chapter page's own
          // 目录 link.
          const proofUrl = anchors?.tocUrl ?? liveUrl(activeTabId);
          if (await navigate(proofUrl)) {
            const proofMarker = await probe();
            if (proofMarker != null) {
              const proofWallHost = hostnameOf(liveUrl(activeTabId)) ?? prevHost;
              if ((await gate(proofWallHost, "wall:" + proofMarker)) === "resolved") {
                continue ladder; // user passed it — same site retried
              }
              blockSite(proofWallHost, "wall:" + proofMarker);
              continue ladder;
            }
            const proof = await finalityProofAgent(
              ctx,
              novel,
              n,
              prev?.title ?? null,
              proofUrl,
            );
            if (proof.kind === "last") {
              storyBackendService.setFinalChapterNumber(threadId, n - 1);
              storyBackendService.deleteSourceChapter(threadId, n);
              await finishBook();
              logger.info("final chapter proven", { threadId, final: n - 1 });
              return "finalChapter";
            }
            if (proof.kind === "wall") {
              const proofWallHost = hostnameOf(liveUrl(activeTabId)) ?? prevHost;
              if ((await gate(proofWallHost, proof.reason)) === "resolved") {
                continue ladder; // user passed it — same site retried
              }
              blockSite(proofWallHost, proof.reason);
              continue ladder;
            }
            // not-last / failed → fall through to the target rung
          }
          // proofUrl unreachable → fall through to the target rung
        }
        // failed (step exhaustion) → fall through to the target rung
        recovery = null;
      }
      // prev.url unreachable → fall through to the next rung
    }

    // --- rung 2: anchors → target chapter from the toc --------------------
    if (anchors && !hostBlocked(anchors.host)) {
      const host = anchors.host;
      attemptedHosts.add(host);
      let rotated = false; // set when the site is abandoned mid-attempts
      for (let attempt = 1; attempt <= MAX_LANDING_RETRIES; attempt++) {
        if (abortSignal?.aborted) break ladder;
        if (!(await navigate(anchors.tocUrl))) break; // toc unreachable
        // The anchored toc may itself live behind a wrapper; whatever page
        // actually OPENED is the host that gets judged and blocked.
        const liveHost = hostnameOf(liveUrl(activeTabId)) ?? anchors.host;
        const marker = await probe();
        if (marker != null) {
          if ((await gate(liveHost, "wall:" + marker)) === "resolved") {
            continue ladder; // user passed it — same site retried
          }
          blockSite(liveHost, "wall:" + marker);
          rotated = true;
          break;
        }
        const result = await targetChapterAgent(
          ctx,
          novel,
          n,
          anchors.tocUrl,
          recovery ?? undefined,
        );
        if (result.kind === "landed") {
          const outcome = await extractHere(liveHost);
          if (outcome != null) return outcome;
          rotated = true; // extraction rotated the site
          break;
        }
        if (result.kind === "wall") {
          if ((await gate(liveHost, result.reason)) === "resolved") {
            continue ladder; // user passed it — same site retried
          }
          blockSite(liveHost, result.reason);
          rotated = true;
          break;
        }
        if (result.kind === "wrong-landing") {
          recovery = {
            target: n,
            lastTitle: result.title,
            lastUrl: result.url,
            attempt,
          };
          continue; // retry landing with the recovery prompt
        }
        // failed (step exhaustion) — counts as a retry, same recovery
      }
      if (rotated) {
        anchors = readAnchors();
        continue ladder;
      }
      // Attempts exhausted or toc unreachable: this site can't land chapter n.
      blockSite(host, "dead-end:landing-failed");
      anchors = readAnchors();
      recovery = null;
      continue ladder;
    }

    // --- rung 3: search for the book ---------------------------------------
    // The search rung is opt-in: without the toggle, a declined (or
    // unanswerable) wall errors the chapter instead of hunting for another
    // host. The escapes are the reader's chapter-link paste, Redo failed
    // after Reset, or enabling the toggle.
    if (!webSearchFallback) {
      if (userRejectedWall) {
        sendWarning(
          i18n.t("story.wallRejectedTitle"),
          i18n.t("story.wallRejectedBody", { host: lastWallHost }),
        );
      }
      logger.warn("rung3 skipped — web search fallback disabled", {
        threadId,
        n,
      });
      break ladder;
    }
    // --- rung 3: search for the book ---------------------------------------
    const candidates = await runBookSearch(
      novel,
      threadId,
      sessionId,
      abortSignal,
    );
    if (candidates.length === 0) {
      // Diagnostics: silent terminal break — say WHY search was empty.
      const blocked = storyBackendService.getBlockedSites(threadId);
      logger.warn("ladder exit — book search returned no candidates", {
        threadId,
        n,
        blockedSites: blocked,
      });
      break ladder; // nothing searchable left
    }
    let anchored = false;
    for (const candidate of candidates) {
      if (abortSignal?.aborted) break ladder;
      if (Date.now() > deadline) {
        logger.warn("chapter deadline exceeded during candidates", {
          threadId,
          n,
        });
        break ladder;
      }
      if (probedUrls.has(candidate)) continue;
      const candidateHost = hostnameOf(candidate);
      if (!candidateHost || hostBlocked(candidateHost)) continue;
      // Budget full ⇒ nothing can proceed: a new opened host would exceed
      // the budget, a known one is already paid/blocked. Skip before paying
      // for a navigation we cannot use.
      if (attemptedHosts.size >= MAX_HOSTS_PER_CHAPTER) continue; // budget
      if (!(await navigate(candidate))) {
        probedUrls.add(candidate);
        continue;
      }
      // Host truth = the OPENED page (webContents.getURL()) — never the
      // candidate string. A candidate href can be an engine wrapper
      // (google /goto?url=…) whose hostname is the ENGINE's, and every
      // wrapper candidate shares it: pre-navigation dedupe/budget on the
      // candidate host would skip ALL remaining destinations once the
      // first wrapper was attempted (observed: 3 usable sites skipped
      // because www.google.com was "already attempted"). All host
      // accounting — blocked, never-re-pay, budget — therefore happens
      // POST-navigation against the opened host.
      const host = hostnameOf(liveUrl(activeTabId)) ?? candidateHost;
      if (hostBlocked(host) || attemptedHosts.has(host)) {
        logger.debug("candidate skipped — opened host already paid/blocked", {
          threadId,
          n,
          candidate,
          host,
        });
        probedUrls.add(candidate);
        continue;
      }
      attemptedHosts.add(host);
      const marker = await probe();
      if (marker != null) {
        // Resolved ⇒ the site is retried from the top of the ladder; the
        // candidate must NOT be marked probed or it would be skipped.
        if ((await gate(host, "wall:" + marker)) === "resolved") {
          continue ladder;
        }
        blockSite(host, "wall:" + marker);
        probedUrls.add(candidate);
        continue;
      }
      const result = await findTocAgent(ctx, novel, candidate);
      if (result.kind === "toc") {
        // tocUrl is the agent's post-redirect live URL; anchor the host of
        // THAT page — same rule: opened page.
        const tocHost = hostnameOf(result.tocUrl) ?? host;
        anchors = {
          host: tocHost,
          bookUrl: candidate,
          tocUrl: result.tocUrl,
        };
        storyBackendService.setSiteAnchors(threadId, anchors);
        logger.info("site anchored", {
          threadId,
          host: tocHost,
          tocUrl: result.tocUrl,
        });
        anchored = true;
        break; // enter the target rung at the next ladder iteration
      }
      if (result.kind === "wall") {
        // The wall was hit on whatever page the agent ended up on — judge
        // THAT host, re-read live (never the candidate string).
        const wallHost = hostnameOf(liveUrl(activeTabId)) ?? host;
        // Resolved ⇒ the site is retried from the top of the ladder; the
        // candidate must NOT be marked probed or it would be skipped.
        if ((await gate(wallHost, result.reason)) === "resolved") {
          continue ladder;
        }
        blockSite(wallHost, result.reason);
        probedUrls.add(candidate);
        continue;
      }
      // wrong-book or failed (step exhaustion) — skip, keep searching
      probedUrls.add(candidate);
    }
    if (!anchored) {
      // Diagnostics: silent terminal break — dump why every candidate was
      // skipped (blocked / already-attempted / budget / navigation failed /
      // wrong-book / failed).
      logger.warn("ladder exit — candidates exhausted without an anchor", {
        threadId,
        n,
        candidates,
        attemptedHosts: [...attemptedHosts],
        probedUrls: [...probedUrls],
        blockedSites: storyBackendService.getBlockedSites(threadId),
      });
      break ladder; // candidates exhausted without an anchor
    }
    // Anchored: next ladder iteration takes the target rung.
  }

  // --- error exit ---------------------------------------------------------
  if (!abortSignal?.aborted) {
    storyBackendService.updateSourceChapter(threadId, n, {
      status: "error",
    });
  }
  return "error";
}
