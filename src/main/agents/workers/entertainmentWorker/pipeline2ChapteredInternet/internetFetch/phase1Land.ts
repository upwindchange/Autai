import { streamText, generateText, isStepCount, tool } from "ai";
import { z } from "zod";
import log from "electron-log/main";
import { createIdGenerator } from "@ai-sdk/provider-utils";
import { simpleModel } from "@agents/providers";
import {
  hasSuccessfulToolResult,
  TIMEOUTS,
  withDomHistoryPruning,
} from "@agents/utils";
import {
  settingsService,
  entertainmentFrontendService,
  entertainmentBackendService,
  SessionTabService,
  TabControlService,
} from "@/services";
import { getFlattenDOMTool } from "@agents/tools/DOMTools";
import { clickElementTool } from "@agents/tools/InteractiveTools";
import { executeSearchQueries } from "@agents/workers/browserWorker/browser-research/search-agent";
import type { ResearchPlan } from "@agents/workers/browserWorker/browser-research/planner";
import type { InternetNovel } from "@shared";
import type { FetchChapterOptions, InternetFetchContext } from "./index";
import { getPageDigest, type PageDigest } from "./pageDigest";
import {
  FinalChapterError,
  blockDomainForThread,
  getBlockedDomains,
} from "./index";
import {
  REJECT_WALL_DESCRIPTION,
  SITE_BLOCKED_TOOL_DESCRIPTION,
  buildUserInteractionWallBlock,
} from "../../shared/crawlWallPrompt";

const generateId = createIdGenerator({ prefix: "call", size: 24 });

const logger = log.scope("Dehydrate:InternetFetch:Phase1");

/**
 * RAM cache of resolved search-result URLs per thread (see landViaSearch).
 * Keyed by threadId; a rotation reuses the pool instead of re-paying the
 * LLM search analysis, and `clearSearchCandidatePools` empties it at
 * crawl-tab release so a NEW book crawl starts fresh.
 */
const searchCandidatePools = new Map<string, string[]>();

/** Drop the thread's cached candidate pool (crawl tab released / book done). */
export function clearSearchCandidatePools(threadId: string): void {
  searchCandidatePools.delete(threadId);
}

// --- Terminal tools ---------------------------------------------------------

/**
 * `landHere` — phase 1's success terminal. The agent calls it once the crawl
 * tab is on the BEGINNING of the target chapter. Its execute captures the REAL
 * page URL from the live WebContentsView (`webContents.getURL()` — never href
 * parsing, so it survives redirects) and writes it to `source_chapters(N).url`.
 * The URL never enters the prompt: it travels out through the tool result and
 * the context (`activeTabId`).
 */
const landHereTool = tool({
  description:
    "Call this when the browser is showing the BEGINNING of the target chapter's prose. Captures the real page URL and records it.",
  inputSchema: z.object({}),
  contextSchema: z.object({
    sessionId: z.string(),
    activeTabId: z.string(),
    threadId: z.string(),
    chapterNumber: z.number(),
  }),
  execute: async (_input, { context: ctx }) => {
    const sts = SessionTabService.getInstance();
    const tab = sts.getTab(ctx.activeTabId);
    const url =
      tab?.webContents && !tab.webContents.isDestroyed() ?
        tab.webContents.getURL()
      : null;
    entertainmentBackendService.updateSourceChapter(
      ctx.threadId,
      ctx.chapterNumber,
      {
        url,
      },
    );
    logger.info("landed — url captured", {
      threadId: ctx.threadId,
      chapterNumber: ctx.chapterNumber,
      url,
    });
    return { url };
  },
});

/**
 * `rejectCandidate` — the search-path judge's "not this page" terminal. The
 * orchestrator's candidate loop treats it as "try the next candidate". The
 * agent never learns the candidate URL; it only sees the loaded page.
 */
const rejectCandidateTool = tool({
  description: `Call this if the current page is NOT the beginning of the target chapter (wrong page, ${REJECT_WALL_DESCRIPTION}, 404/error, homepage, table of contents/index, or a DIFFERENT piece of content).`,
  inputSchema: z.object({ reason: z.string() }),
  execute: async ({ reason }) => ({ rejected: true, reason }),
});

/**
 * `siteBlocked` — shared-wall terminal for advance + TOC. Description from
 * the canonical wall module; behavior identical to the former local tool.
 */
const siteBlockedTool = tool({
  description: SITE_BLOCKED_TOOL_DESCRIPTION,
  inputSchema: z.object({ reason: z.string() }),
  execute: async ({ reason }) => ({ blocked: true, reason }),
});

/**
 * `abortChapter` — the advance-path failure terminal. An explicit, confident
 * abort means the agent sees no next-chapter link AND no TOC entry for N on
 * the CURRENT page. It NO LONGER maps straight to `FinalChapterError`: a
 * paywalled last-visible page is indistinguishable from the book's true end at
 * this point. `landOnChapter` routes it into the TOC fallback first, and only
 * a TOC that READS the chapter list and finds no N confirms finality.
 */
const abortChapterTool = tool({
  description:
    "Call this only per the prompt's exact abort condition (you could not reach the target chapter and are confident no next-chapter link / TOC entry exists). Provide a short reason.",
  inputSchema: z.object({ reason: z.string() }),
  execute: async ({ reason }) => ({ aborted: true, reason }),
});

function isAbsoluteUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
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

// --- Landing outcomes -------------------------------------------------------
//
// Phase 1's paths report discriminated outcomes instead of throwing, so
// `landOnChapter` can chain fallbacks:
//   landed          — `landHere` fired; the URL is already written; phase 2
//                     may start immediately.
//   aborted         — advance-path `abortChapter`: the agent believes the
//                     current site has no chapter N. NOT finality on its own.
//   blocked         — the current site is unusable (paywall/captcha/step
//                     exhaustion/etc.). The chain marks the site dead and
//                     searches for a different one.
//   chapterMissing  — a READABLE TOC provably has no entry for N: the only
//                     legitimate `FinalChapterError` signal.

type AdvanceOutcome =
  | { kind: "landed" }
  | { kind: "aborted"; reason: string }
  | { kind: "blocked"; reason: string };

type TocOutcome =
  | { kind: "landed" }
  | { kind: "chapterMissing" }
  | { kind: "blocked"; reason: string };

/**
 * Build a one-query `ResearchPlan` for `executeSearchQueries` from the wizard's
 * novel origin. `novel.source` is guidance (not a URL here); title/author add
 * precision. The query is deliberately BOOK-level: chapter-number queries
 * ("title author 第N章") index poorly and pull in wiki/aggregator noise, while
 * a book's page on a reading site is its strongest-indexed entry point. The
 * target chapter is then reached by CLICKING through that site's TOC (the
 * judge rejects book-home/TOC pages, which become `landViaToc` anchors) —
 * never by searching for the chapter page itself. This also holds for retries
 * of an errored N>1, which re-anchor the same way.
 */
function buildSearchPlan(
  novel: InternetNovel,
  chapterNumber: number,
): ResearchPlan {
  const base = novel.title.trim() || novel.source.trim();
  const query = [base, novel.author?.trim(), "小说"].filter(Boolean).join(" ");
  return {
    id: `ent-fetch-plan-${chapterNumber}`,
    title: base,
    description: `Find the novel's page on an online reading site (book homepage / table of contents). Chapter ${chapterNumber} is reached afterwards via the site's own TOC, not via search.`,
    queries: [
      {
        id: `ent-fetch-plan-${chapterNumber}-q0`,
        query,
        focus: `${base} on an online-reading site — the book homepage, its table-of-contents page, or any reading page of THIS novel on that site (the book homepage / TOC is ideal; do not look for any specific chapter number). NOT wiki/encyclopedia/pedia pages (Wikipedia, 百度百科, 搜狗百科, 360百科, etc.), which only have introductions`,
      },
    ],
  };
}

function buildJudgeSystemPrompt(
  novel: InternetNovel,
  chapterNumber: number,
): string {
  const label = `chapter ${chapterNumber}`;
  const titlePart = novel.title.trim() || "the requested novel";
  const authorPart = novel.author?.trim() ? ` by ${novel.author.trim()}` : "";
  return `You are judging whether the page currently loaded in the browser is the beginning of a specific piece of content.

Target: ${label} of "${titlePart}"${authorPart}.

The page is ALREADY open — do NOT navigate anywhere. Read it with getFlattenDOM, then decide:
- If the page IS the beginning of ${label}'s actual prose content, call landHere.
- If it is NOT the beginning of ${label}'s prose — a search engine, 404/error page, site homepage, table of contents / index, a DIFFERENT piece of content, or a USER-INTERACTION WALL (see below) — call rejectCandidate with a short reason.
- Encyclopedia/wiki/pedia pages (Wikipedia, 百度百科, 搜狗百科, 360百科, 互动百科, etc.) are NEVER the target — they only contain an introduction ABOUT the novel, never its chapter prose. Call rejectCandidate immediately, without spending further steps examining them.

${buildUserInteractionWallBlock(
  "call rejectCandidate with the wall type as the reason (the orchestrator moves to the next candidate URL)",
)}

Call landHere ONLY when the page is truly showing the start of ${label}'s prose.`;
}

/**
 * Digest variant of the judge prompt: same target/wall/pedia guidance as
 * `buildJudgeSystemPrompt`, but the input is a ~1.2k-char page digest instead
 * of a DOM tree — no tools, one verdict call.
 */
function buildJudgeDigestPrompt(
  novel: InternetNovel,
  chapterNumber: number,
): string {
  const label = `chapter ${chapterNumber}`;
  const titlePart = novel.title.trim() || "the requested novel";
  const authorPart = novel.author?.trim() ? ` by ${novel.author.trim()}` : "";
  return `You are judging whether a page is the beginning of a specific piece of content. You are given a JSON digest of the page: title, first heading, url, text (first ~1200 chars of visible body text), and wallMarkers (wall-vocabulary substrings found in the text — hints that may also appear as page chrome on readable pages; decide from the text).

Target: ${label} of "${titlePart}"${authorPart}.

- If the page IS the beginning of ${label}'s actual prose content, call judgeVerdict with verdict "landHere".
- If it is NOT the beginning of ${label}'s prose — a search engine, 404/error page, site homepage, table of contents / index, a DIFFERENT piece of content, or a USER-INTERACTION WALL (see below) — call judgeVerdict with verdict "rejectCandidate" and a short reason.
- Encyclopedia/wiki/pedia pages (Wikipedia, 百度百科, 搜狗百科, 360百科, 互动百科, etc.) are NEVER the target — they only contain an introduction ABOUT the novel, never its chapter prose.

${buildUserInteractionWallBlock(
  'call judgeVerdict with verdict "rejectCandidate" and the wall type as the reason (the orchestrator moves to the next candidate URL)',
)}

Call judgeVerdict exactly once. Call it with "landHere" ONLY when the digest truly shows the start of ${label}'s prose.`;
}

function buildAdvanceSystemPrompt(
  novel: InternetNovel,
  chapterNumber: number,
): string {
  const titlePart = novel.title.trim() || "the novel";
  return `You are a web-navigation agent controlling a browser via tools. You are currently viewing the END of chapter ${chapterNumber - 1} of "${titlePart}". Your goal is to reach the BEGINNING of chapter ${chapterNumber}.

Steps:
1. Call getFlattenDOM to read the current page.
2. Find the control/link to the NEXT chapter. Common labels: "下一章", "下章", "next chapter", "next", "后一章", or a right-arrow. If there is no direct next-chapter link, look for a table of contents (目录 / 章节列表) and find the entry for chapter ${chapterNumber}.
3. Call clickElement on that control's backendNodeId.
4. Call getFlattenDOM again to read the new page and confirm it is the beginning of chapter ${chapterNumber}.

When you are on the beginning of chapter ${chapterNumber}, call landHere.

${buildUserInteractionWallBlock(
  "call siteBlocked with the wall type as the reason (the site will be marked unusable and the crawl will switch to a different one)",
)}

ONLY call abortChapter when you are CONFIDENT there is NO next-chapter link AND NO table-of-contents entry for chapter ${chapterNumber}, and you are not blocked by any wall (see above). Before aborting, retry: re-read the page, look for a TOC toggle/menu, and try alternative controls several times. Calling abortChapter means chapter ${chapterNumber - 1} was the LAST chapter of the book.

Rules:
- Use only the tools provided.
- Never click into encyclopedia/wiki/pedia pages (Wikipedia, 百度百科, 搜狗百科, 360百科, 互动百科, etc.) — they only contain an introduction ABOUT the novel, never chapter content.
- Do not call landHere until you are certain you are on chapter ${chapterNumber}'s beginning.`;
}

/**
 * TOC-fallback prompt. Given an anchor page ON THE CURRENT SITE (a rejected
 * candidate — typically the book homepage or TOC page the search path found —
 * the previous chapter's page, or the source URL), find and click the table
 * of contents (目录 / 章节列表), then the entry for chapter N. This is the
 * PRIMARY route to any mid-book chapter: search deliberately finds only
 * book-level pages, and the TOC is how the chapter is actually reached.
 *
 * TOC-FIRST MANDATE: after landing from the search engine, the agent's first
 * action (after reading the page) is ALWAYS to get the TOC open — never a
 * "start reading" button (those jump to chapter 1 / a resume point), never a
 * loose chapter link. Every subsequent move happens inside the TOC. Enforced
 * as a strict step order plus explicit prohibitions in the prompt; click
 * targets can't be semantically vetted deterministically.
 *
 * A readable TOC with NO entry for N → chapterMissing (finality signal). A
 * paywalled/captcha'd TOC is NOT finality — the agent must report blocked.
 */
function buildTocSystemPrompt(
  novel: InternetNovel,
  chapterNumber: number,
): string {
  const titlePart = novel.title.trim() || "the novel";
  return `You are a web-navigation agent controlling a browser via tools. A page of "${titlePart}" is open on a reading site — typically the book's homepage or a reading page that a search engine led to. Your goal is the BEGINNING of chapter ${chapterNumber}, and the table of contents (目录 / 章节列表 / chapter list / contents / 全部章节) is the ONLY road there. Your very first action after reading the page must be to get the TOC open; everything else happens inside it.

Steps — strictly in this order:
1. Call getFlattenDOM to read the current page.
2. Get the table of contents OPEN before clicking anything else:
   - If the page already shows the chapter list (even partially), use it directly.
   - Otherwise click the TOC control/link (目录 / 章节列表 / 全部章节 / chapter list / contents) with clickElement.
3. Inside the TOC, find the entry for chapter ${chapterNumber} (match the number, e.g. "第${chapterNumber}章", "${chapterNumber}", or the chapter title). Long TOCs are often collapsed or paginated:
   - Look for a "展开 / 全部章节 / 显示全部 / expand" toggle that reveals the full list — click it first.
   - Use the TOC's own pagination controls (下一页 / page numbers / jump-to-page input) until the entry is visible. For very long books, prefer a page-jump input over clicking "next" repeatedly.
   - Some sites load more entries as you scroll — if the list looks truncated, scroll and re-read the DOM.
4. clickElement on that entry, then getFlattenDOM to confirm the new page shows the BEGINNING of chapter ${chapterNumber}.
5. On success call landHere.

NEVER click a "start reading" style button (开始阅读 / 立即阅读 / 免费阅读 / 继续阅读 / start reading / read now): it jumps to chapter 1 or the site's resume point — even when chapter 1 IS the target, use the TOC's own entry. Before the TOC is open, the only control you may click is the TOC control itself; once it is open, the only chapter link you may click is the TOC entry for chapter ${chapterNumber}.

If the TOC is readable and loaded but there is genuinely NO entry for chapter ${chapterNumber} anywhere in it (you expanded/paginated through the end), call chapterMissing.

${buildUserInteractionWallBlock(
  "call siteBlocked with the wall type as the reason (the site will be marked unusable and the crawl will switch to a different one)",
)}

Rules:
- Use only the tools provided.
- Do not guess or fabricate: chapterMissing only after actually reading the TOC list.
- Never navigate to a search engine or perform any web search; only click controls on the current site.
- Do not call landHere until you are certain you are on chapter ${chapterNumber}'s beginning.`;
}

/**
 * `chapterMissing` — the TOC agent's failure terminal. (readable TOC,
 * provably no N) is the ONLY signal that confirms `FinalChapterError`;
 * `siteBlocked` (shared, from crawlWallPrompt) marks the site dead instead.
 */
const chapterMissingTool = tool({
  description:
    "Call this when the table of contents is readable and fully examined (paginated to the end) and there is genuinely no entry for the target chapter.",
  inputSchema: z.object({ reason: z.string() }),
  execute: async ({ reason }) => ({ missing: true, reason }),
});

// --- Search-path judge (one candidate) --------------------------------------

/**
 * Run the judge against the page already loaded in the crawl tab.
 * Digest path: one `generateText` call over a ~1.2k-char page digest (title,
 * heading, url, first text) — no DOM tree build, no change detection. Falls
 * back to the DOM-tree agent when the digest is thin (<200 chars of text) or
 * collection fails (detached debugger): a shadow-DOM/JS-render page yields a
 * near-empty digest, and the DOM judge still reads it. Returns true iff the
 * verdict was landHere (URL already written by `landHereTool`).
 */
async function judgeCandidate(
  novel: InternetNovel,
  ctx: InternetFetchContext,
): Promise<boolean> {
  let digest: PageDigest | null = null;
  try {
    digest = await getPageDigest(ctx.activeTabId);
  } catch (err) {
    logger.warn("digest collection failed; falling back to DOM judge", {
      threadId: ctx.threadId,
      chapterNumber: ctx.chapterNumber,
      err,
    });
  }
  if (digest && digest.text.trim().length >= 200) {
    const verdict = await judgeCandidateViaDigest(novel, ctx, digest);
    if (verdict === "landHere") {
      await landHereTool.execute!(
        {},
        {
          toolCallId: generateId(),
          messages: [],
          context: ctx,
        },
      );
      return true;
    }
    return false;
  }
  logger.info("judge digest too thin; falling back to DOM", {
    threadId: ctx.threadId,
    chapterNumber: ctx.chapterNumber,
    textLength: digest?.text.length ?? 0,
  });
  return judgeCandidateViaDom(novel, ctx);
}

/** Verdict tool for the digest-path judge. */
const judgeVerdictTool = tool({
  description: "Return the verdict for the candidate page",
  inputSchema: z.object({
    verdict: z.enum(["landHere", "rejectCandidate"]),
    reason: z.string().optional(),
  }),
  execute: async (i) => i,
});

/** One-shot digest judge: returns the verdict, or null on model failure. */
async function judgeCandidateViaDigest(
  novel: InternetNovel,
  ctx: InternetFetchContext,
  digest: PageDigest,
): Promise<"landHere" | "rejectCandidate" | null> {
  const result = await generateText({
    model: simpleModel().model,
    instructions: buildJudgeDigestPrompt(novel, ctx.chapterNumber),
    prompt: JSON.stringify(digest),
    tools: { judgeVerdict: judgeVerdictTool },
    toolChoice: "required",
    maxRetries: 0,
    abortSignal: ctx.abortSignal,
    telemetry: {
      isEnabled: settingsService.settings.langfuse.enabled,
      functionId: "entertainment-internet-judge-digest",
    },
  });
  const call = result.toolCalls.find((c) => c.toolName === "judgeVerdict");
  const verdict = call?.input as
    | { verdict: "landHere" | "rejectCandidate"; reason?: string }
    | undefined;
  logger.debug("judge verdict from digest", {
    threadId: ctx.threadId,
    chapterNumber: ctx.chapterNumber,
    verdict: verdict?.verdict ?? "none",
    reason: verdict?.reason,
  });
  return verdict?.verdict ?? null;
}

/**
 * The ORIGINAL DOM-tree judge, kept as the thin-digest fallback. Reads the
 * page with getFlattenDOM and calls landHere / rejectCandidate (URL captured
 * by landHereTool itself).
 */
async function judgeCandidateViaDom(
  novel: InternetNovel,
  ctx: InternetFetchContext,
): Promise<boolean> {
  const label = `chapter ${ctx.chapterNumber}`;
  const result = streamText({
    model: simpleModel().model,
    instructions: buildJudgeSystemPrompt(novel, ctx.chapterNumber),
    messages: [
      {
        role: "user",
        content: `Is this page the beginning of ${label}? Read it with getFlattenDOM, then call landHere or rejectCandidate.`,
      },
    ],
    tools: {
      getFlattenDOM: getFlattenDOMTool,
      landHere: landHereTool,
      rejectCandidate: rejectCandidateTool,
    },
    stopWhen: [
      hasSuccessfulToolResult("landHere"),
      hasSuccessfulToolResult("rejectCandidate"),
      isStepCount(4),
    ],
    maxRetries: 0,
    timeout: TIMEOUTS.actionExecution,
    abortSignal: ctx.abortSignal,
    toolsContext: { getFlattenDOM: ctx, landHere: ctx },
    telemetry: {
      isEnabled: settingsService.settings.langfuse.enabled,
      functionId: "entertainment-internet-judge",
    },
  });
  const steps = await result.steps;
  return steps
    .flatMap((s) => s.toolResults ?? [])
    .some((tr) => tr.toolName === "landHere" && tr.type === "tool-result");
}

/**
 * Search path — deterministic candidate loop. The orchestrator navigates the
 * crawl tab to each candidate URL (`TabControlService.navigateTo`), then runs
 * a minimal judge agent that only reads the page and decides land/reject. This
 * keeps the candidate URLs out of the agent's context (smaller prompt, faster
 * convergence) and bounds each judgment to its own agent-level timeout instead
 * of one giant multi-candidate agent. On `landHere` the loop exits early; on
 * reject / navigate-failure / timeout it continues to the next candidate.
 *
 * `probedUrls` — URLs already probed (or known bad) this chapter; skipped,
 *   and WRITTEN as candidates are consumed (pre-filter + probe) so the
 *   fetch-level set dedups on final destinations across rotations.
 * `excludeDomains` — hostnames judged dead for this thread; their candidates
 *   are filtered out entirely (a re-search after blocking a site must land on
 *   a DIFFERENT site).
 *
 * REJECTED candidates are returned as `tocAnchors`: a page the judge rejects
 * as "not the beginning of chapter N" (a TOC page, chapter 1's page, the
 * novel's homepage) is still a perfectly good NAVIGATION anchor — the TOC
 * fallback can open it and click through to chapter N.
 */
async function landViaSearch(
  novel: InternetNovel,
  ctx: InternetFetchContext,
  probedUrls: Set<string>,
  excludeDomains: ReadonlySet<string>,
): Promise<{ landed: boolean; tocAnchors: string[] }> {
  // 1) Gather candidates. [novel.source] if it's already a URL; otherwise one
  //    query via executeSearchQueries, CACHED per thread: the LLM search
  //    analysis is the expensive part (page load + model call), and site
  //    rotation re-enters here per dead site. A cached pool is re-used only
  //    when at least one candidate survives BOTH filters — blocked domains AND
  //    already-probed URLs (a pool whose every URL was probed-but-unblocked is
  //    NOT usable: the candidate loop below would drop it all and starve the
  //    rotation instead of triggering a fresh search). Only a fully-consumed
  //    pool re-searches. Cleared when the crawl tab is released (book end).
  let candidates: string[];
  if (isAbsoluteUrl(novel.source.trim())) {
    candidates = [novel.source.trim()];
  } else {
    const blocked = excludeDomains;
    const usable = searchCandidatePools.get(ctx.threadId)?.filter((url) => {
      const host = hostnameOf(url);
      if (host && blocked.has(host)) return false;
      return !probedUrls.has(url);
    });
    if (usable && usable.length > 0) {
      candidates = usable;
      logger.info("using cached search candidates", {
        threadId: ctx.threadId,
        usable: usable.length,
      });
    } else {
      const plan = buildSearchPlan(novel, ctx.chapterNumber);
      // executeSearchQueries creates/destroys its own tabs in this session,
      // but SessionTabService only tracks tabs for a session that has been
      // activated (createTab registers into `sessionStates[sessionId]` only
      // if it exists). Without activateSession, getTabsForSession returns
      // [] → 0 candidates.
      const searchSessionId = `ent-search-${ctx.threadId}`;
      const sts = SessionTabService.getInstance();
      await sts.activateSession(searchSessionId);
      try {
        const results = await executeSearchQueries(
          plan,
          searchSessionId,
          "",
          { write() {} },
          undefined,
          ctx.abortSignal,
          getBlockedDomains(ctx.threadId),
        );
        candidates = results.map((r) => r.url).filter((u) => !!u);
        searchCandidatePools.set(ctx.threadId, candidates);
      } finally {
        // Restore the crawl session as active so the crawl tab is visible again.
        await sts.activateSession(ctx.sessionId);
      }
    }
  }
  // Filter dead domains + already-probed URLs. Keep first occurrence only.
  const tocAnchors: string[] = [];
  const filtered = candidates.filter((url) => {
    const host = hostnameOf(url);
    if (host && excludeDomains.has(host)) return false;
    if (probedUrls.has(url)) return false;
    probedUrls.add(url);
    return true;
  });
  logger.info("search candidates", {
    threadId: ctx.threadId,
    chapterNumber: ctx.chapterNumber,
    raw: candidates.length,
    count: filtered.length,
  });

  // 2) Probe each candidate deterministically: navigate, then ask the judge.
  //    Rejects are collected as TOC anchors for the fallback.
  const tcs = TabControlService.getInstance();
  for (const candidateUrl of filtered) {
    logger.debug("probing candidate", {
      threadId: ctx.threadId,
      chapterNumber: ctx.chapterNumber,
      url: candidateUrl,
    });
    try {
      await tcs.navigateTo(ctx.activeTabId, candidateUrl);
    } catch (err) {
      logger.warn("navigate to candidate failed; trying next", {
        url: candidateUrl,
        err,
      });
      continue;
    }
    // Chromium has followed every redirect (engine wrapper, shortener, JS/meta):
    // read the REAL destination from the live tab.
    const sts = SessionTabService.getInstance();
    const tab = sts.getTab(ctx.activeTabId);
    const finalUrl =
      tab?.webContents && !tab.webContents.isDestroyed()
        ? tab.webContents.getURL()
        : candidateUrl;
    // Two different wrappers leading to the same destination: second is a no-op.
    if (finalUrl !== candidateUrl && probedUrls.has(finalUrl)) {
      continue;
    }
    const finalHost = hostnameOf(finalUrl);
    // The agent-side skip is best-effort; THIS is the authoritative check. The
    // DESTINATION (not the wrapper host) may be a blocklisted dead site — skip
    // the judge entirely, record both URLs as probed.
    if (finalHost && excludeDomains.has(finalHost)) {
      logger.info("candidate redirected to blocked site; skipping", {
        candidateUrl,
        finalUrl,
      });
      probedUrls.add(finalUrl);
      continue;
    }
    if (await judgeCandidate(novel, ctx)) {
      return { landed: true, tocAnchors };
    }
    // Record the REAL url: TOC anchors must open the real page and the hoisted
    // probed set must dedup on final destinations, not engine wrappers.
    probedUrls.add(finalUrl);
    tocAnchors.push(finalUrl);
  }
  return { landed: false, tocAnchors };
}

/**
 * Advance path — from the carried-over crawl tab, click next-chapter / TOC to
 * reach chapter N. Recovery: if the tab isn't on a real page (e.g. after
 * restart), re-navigate to `source_chapters(N-1).url` first — the sole DB-URL
 * read. Outcomes: `landed` (landHere fired) / `aborted` (agent's confident
 * no-chapter-N claim — pending TOC confirmation) / `blocked` (siteBlocked
 * fired on a login/paywall/captcha/age-gate, step exhaustion, or no recovery
 * anchor — the chain then tries the TOC fallback, and a wall there marks the
 * site dead for a re-search elsewhere).
 */
async function landViaAdvance(
  novel: InternetNovel,
  ctx: InternetFetchContext,
): Promise<AdvanceOutcome> {
  const sts = SessionTabService.getInstance();
  const tab = sts.getTab(ctx.activeTabId);
  const current =
    tab?.webContents && !tab.webContents.isDestroyed() ?
      tab.webContents.getURL()
    : "";
  if (!/^https?:\/\//i.test(current)) {
    const prev = entertainmentFrontendService.getSourceChapter(
      ctx.threadId,
      ctx.chapterNumber - 1,
    );
    const prevUrl = prev?.url;
    if (!prevUrl) {
      return {
        kind: "blocked",
        reason: `No anchor URL for previous chapter ${ctx.chapterNumber - 1}`,
      };
    }
    logger.info("recovery re-anchor", {
      threadId: ctx.threadId,
      chapterNumber: ctx.chapterNumber,
      prevUrl,
    });
    await TabControlService.getInstance().navigateTo(ctx.activeTabId, prevUrl);
  }

  const result = streamText({
    model: withDomHistoryPruning(simpleModel().model),
    instructions: buildAdvanceSystemPrompt(novel, ctx.chapterNumber),
    messages: [
      {
        role: "user",
        content: `Reach the beginning of chapter ${ctx.chapterNumber} from the current page.`,
      },
    ],
    tools: {
      getFlattenDOM: getFlattenDOMTool,
      clickElement: clickElementTool,
      landHere: landHereTool,
      abortChapter: abortChapterTool,
      siteBlocked: siteBlockedTool,
    },
    stopWhen: [
      hasSuccessfulToolResult("landHere"),
      hasSuccessfulToolResult("abortChapter"),
      hasSuccessfulToolResult("siteBlocked"),
      isStepCount(12),
    ],
    maxRetries: 1,
    timeout: TIMEOUTS.actionExecution,
    abortSignal: ctx.abortSignal,
    toolsContext: { getFlattenDOM: ctx, clickElement: ctx, landHere: ctx },
    telemetry: {
      isEnabled: settingsService.settings.langfuse.enabled,
      functionId: "entertainment-internet-land",
    },
  });

  const toolResults = (await result.steps).flatMap((s) => s.toolResults ?? []);
  if (
    toolResults.some(
      (tr) => tr.toolName === "landHere" && tr.type === "tool-result",
    )
  ) {
    return { kind: "landed" }; // url already written by landHere
  }
  const abort = toolResults.find(
    (tr) => tr.toolName === "abortChapter" && tr.type === "tool-result",
  );
  if (abort) {
    const reason =
      typeof abort.output === "object" && abort.output !== null ?
        String((abort.output as { reason?: unknown }).reason ?? "")
      : "";
    return { kind: "aborted", reason };
  }
  const blocked = toolResults.find(
    (tr) => tr.toolName === "siteBlocked" && tr.type === "tool-result",
  );
  if (blocked) {
    const reason =
      typeof blocked.output === "object" && blocked.output !== null ?
        String((blocked.output as { reason?: unknown }).reason ?? "")
      : "";
    return { kind: "blocked", reason };
  }
  return {
    kind: "blocked",
    reason: `advance step exhaustion for chapter ${ctx.chapterNumber}`,
  };
}

/**
 * TOC fallback — navigate to one anchor URL, then let the TOC agent find and
 * click chapter N's entry. Anchors are tried in order (rejected search
 * candidates first — richest navigation surface — then the DB's N-1 URL);
 * `landed` short-circuits, `chapterMissing` confirms finality, per-anchor
 * failure moves to the next anchor. All anchors exhausted → `blocked`.
 */
async function landViaToc(
  novel: InternetNovel,
  ctx: InternetFetchContext,
  anchors: readonly string[],
): Promise<TocOutcome> {
  const tcs = TabControlService.getInstance();
  for (const anchor of anchors) {
    logger.info("toc fallback anchor", {
      threadId: ctx.threadId,
      chapterNumber: ctx.chapterNumber,
      anchor,
    });
    try {
      await tcs.navigateTo(ctx.activeTabId, anchor);
    } catch (err) {
      logger.warn("toc anchor navigate failed", { anchor, err });
      continue;
    }
    const result = streamText({
      model: withDomHistoryPruning(simpleModel().model),
      instructions: buildTocSystemPrompt(novel, ctx.chapterNumber),
      messages: [
        {
          role: "user",
          content: `Find chapter ${ctx.chapterNumber} in the table of contents and open it.`,
        },
      ],
      tools: {
        getFlattenDOM: getFlattenDOMTool,
        clickElement: clickElementTool,
        landHere: landHereTool,
        chapterMissing: chapterMissingTool,
        siteBlocked: siteBlockedTool,
      },
      stopWhen: [
        hasSuccessfulToolResult("landHere"),
        hasSuccessfulToolResult("chapterMissing"),
        hasSuccessfulToolResult("siteBlocked"),
        isStepCount(24), // deep TOC pagination: expand + jump pages + click entry
      ],
      maxRetries: 1,
      timeout: TIMEOUTS.actionExecution,
      abortSignal: ctx.abortSignal,
      toolsContext: { getFlattenDOM: ctx, clickElement: ctx, landHere: ctx },
      telemetry: {
        isEnabled: settingsService.settings.langfuse.enabled,
        functionId: "entertainment-internet-toc",
      },
    });
    const toolResults = (await result.steps).flatMap(
      (s) => s.toolResults ?? [],
    );
    const fired = (name: string) =>
      toolResults.some(
        (tr) => tr.toolName === name && tr.type === "tool-result",
      );
    if (fired("landHere")) return { kind: "landed" }; // url written by landHere
    if (fired("chapterMissing")) return { kind: "chapterMissing" };
    // siteBlocked or step exhaustion on this anchor → try the next anchor.
  }
  return {
    kind: "blocked",
    reason: `TOC fallback exhausted ${anchors.length} anchor(s)`,
  };
}

// --- Phase 1 entry ----------------------------------------------------------

/**
 * Phase 1 — land the crawl tab on chapter N's beginning + persist the URL.
 * Fallback chain (per the site-death model):
 *
 *  1. PRIMARY — advance (N>1 from the carried tab) or search (chapter 1 /
 *     mid-book start / retry). Success = landHere → phase 2 runs.
 *  2. TOC fallback — same-site rescue: rejected search candidates + the N-1
 *     DB URL become anchors; a TOC agent clicks through to N. `chapterMissing`
 *     (readable TOC, provably no N) → FinalChapterError — the ONLY finality
 *     signal. Advance `abortChapter` is routed here too: its "no next link"
 *     claim must be confirmed by actually reading a TOC (a paywalled tail page
 *     looks identical to the book's end).
 *  3. SITE DEATH + re-search — primary+TOC failed on the current site
 *     (paywall/captcha/unreachable). Mark the site's hostname dead for the
 *     thread (`blockDomainForThread`) and re-run the search path with dead
 *     domains + probed URLs excluded, so the chain lands on a DIFFERENT site;
 *     its rejected candidates feed one more TOC pass there.
 *
 * FinalChapterError only from step 2. Everything else exhausted → generic
 * error (row marked `error`; user retry re-enters the chain at search).
 */
export async function landOnChapter(
  novel: InternetNovel,
  ctx: InternetFetchContext,
  options: FetchChapterOptions,
): Promise<void> {
  const n = ctx.chapterNumber;
  // Reuse the fetch-level probed set when the rotation loop passed one, so a
  // rotation's re-landing never re-judges a candidate already rejected in an
  // earlier attempt of the SAME fetch.
  const probedUrls = options.probedUrls ?? new Set<string>();
  const tocAnchors: string[] = [];

  // --- Step 1: primary path -------------------------------------------------
  const useSearch = n === 1 || options.useSearch === true;
  if (useSearch) {
    const search = await landViaSearch(
      novel,
      ctx,
      probedUrls,
      getBlockedDomains(ctx.threadId),
    );
    for (const u of search.tocAnchors) {
      tocAnchors.push(u);
    }
    if (search.landed) return;
  } else {
    const advance = await landViaAdvance(novel, ctx);
    if (advance.kind === "landed") return;
    // abortChapter claims book-end — confirm via TOC before believing it.
    if (advance.kind === "aborted") {
      logger.info("advance aborted — confirming via TOC", {
        threadId: ctx.threadId,
        chapterNumber: n,
        reason: advance.reason,
      });
    }
    // The carried tab (or DB N-1 URL) is the natural same-site anchor.
    const prev = entertainmentFrontendService.getSourceChapter(
      ctx.threadId,
      n - 1,
    );
    if (prev?.url && !probedUrls.has(prev.url)) {
      probedUrls.add(prev.url);
      tocAnchors.push(prev.url);
    }
  }

  // --- Step 2: same-site TOC fallback ---------------------------------------
  if (tocAnchors.length > 0) {
    const toc = await landViaToc(novel, ctx, tocAnchors);
    if (toc.kind === "landed") return;
    if (toc.kind === "chapterMissing") throw new FinalChapterError();
    // blocked → site death
  }

  // --- Step 3: block the site, re-search on a different one -----------------
  const sts = SessionTabService.getInstance();
  const tab = sts.getTab(ctx.activeTabId);
  const deadHost =
    tab?.webContents && !tab.webContents.isDestroyed() ?
      hostnameOf(tab.webContents.getURL())
    : null;
  if (deadHost) blockDomainForThread(ctx.threadId, deadHost, "landing failed");

  const reSearch = await landViaSearch(
    novel,
    ctx,
    probedUrls,
    getBlockedDomains(ctx.threadId),
  );
  if (reSearch.landed) return;

  // One TOC pass on the NEW site's rejected candidates (different site, so a
  // chapterMissing here is still trustworthy — the dead site's TOC wasn't).
  if (reSearch.tocAnchors.length > 0) {
    const toc = await landViaToc(novel, ctx, reSearch.tocAnchors);
    if (toc.kind === "landed") return;
    if (toc.kind === "chapterMissing") throw new FinalChapterError();
  }
  throw new Error(`Could not land on chapter ${n} (all fallbacks exhausted)`);
}
