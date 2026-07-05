import { streamText, stepCountIs, tool } from "ai";
import { z } from "zod";
import log from "electron-log/main";
import { complexModel } from "@agents/providers";
import { hasSuccessfulToolResult, TIMEOUTS } from "@agents/utils";
import {
  settingsService,
  entertainmentService,
  SessionTabService,
  TabControlService,
} from "@/services";
import { getFlattenDOMTool } from "@agents/tools/DOMTools";
import { clickElementTool } from "@agents/tools/InteractiveTools";
import { executeSearchQueries } from "@agents/workers/browserWorker/browser-research/search-agent";
import type { ResearchPlan } from "@agents/workers/browserWorker/browser-research/planner";
import type { InternetNovel } from "@shared";
import type { FetchChapterOptions, InternetFetchContext } from "./index";
import { FinalChapterError } from "./index";

const logger = log.scope("Dehydrate:InternetFetch:Phase1");

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
  execute: async (_input, { experimental_context }) => {
    const ctx = experimental_context as InternetFetchContext;
    const sts = SessionTabService.getInstance();
    const tab = sts.getTab(ctx.activeTabId);
    const url =
      tab?.webContents && !tab.webContents.isDestroyed() ?
        tab.webContents.getURL()
      : null;
    entertainmentService.updateSourceChapter(ctx.threadId, ctx.chapterNumber, {
      url,
    });
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
  description:
    "Call this if the current page is NOT the beginning of the target chapter (wrong page, login wall, paywall, recaptcha, age gate, 404/error, homepage, table of contents/index, or a DIFFERENT piece of content).",
  inputSchema: z.object({ reason: z.string() }),
  execute: async ({ reason }) => ({ rejected: true, reason }),
});

/**
 * `abortChapter` — the advance-path failure terminal. An explicit, confident
 * abort means no next-chapter link AND no TOC entry exist → the previous
 * chapter was the LAST one (→ `FinalChapterError`).
 */
const abortChapterTool = tool({
  description:
    "Call this only per the prompt's exact abort condition (you could not reach the target chapter and are confident no next-chapter link / TOC entry exists). Provide a short reason.",
  inputSchema: z.object({ reason: z.string() }),
  execute: async ({ reason }) => ({ aborted: true, reason }),
});

// --- Helpers ----------------------------------------------------------------

function isAbsoluteUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function contentLabel(nonNovelSource: boolean, chapterNumber: number): string {
  return nonNovelSource ? "the post/article" : `chapter ${chapterNumber}`;
}

/**
 * Build a one-query `ResearchPlan` for `executeSearchQueries` from the wizard's
 * novel origin. `novel.source` is guidance (not a URL here); title/author add
 * precision. The query targets this specific chapter so a retry of an errored
 * N>1 can re-anchor via search.
 */
function buildSearchPlan(
  novel: InternetNovel,
  chapterNumber: number,
): ResearchPlan {
  const base = novel.title.trim() || novel.source.trim();
  const chapterHint = chapterNumber === 1 ? "小说" : `第${chapterNumber}章`;
  const query = [base, novel.author?.trim(), chapterHint]
    .filter(Boolean)
    .join(" ");
  return {
    id: `ent-fetch-plan-${chapterNumber}`,
    title: base,
    description:
      chapterNumber === 1 ?
        `Find the first chapter / reading page of the novel.`
      : `Find chapter ${chapterNumber} of the novel.`,
    queries: [
      {
        id: `ent-fetch-plan-${chapterNumber}-q0`,
        query,
        focus: `chapter ${chapterNumber} of ${base} — the page where the chapter content begins`,
      },
    ],
  };
}

function buildJudgeSystemPrompt(
  novel: InternetNovel,
  chapterNumber: number,
  nonNovelSource: boolean,
): string {
  const label = contentLabel(nonNovelSource, chapterNumber);
  const titlePart = novel.title.trim() || "the requested novel";
  const authorPart = novel.author?.trim() ? ` by ${novel.author.trim()}` : "";
  return `You are judging whether the page currently loaded in the browser is the beginning of a specific piece of content.

Target: ${label} of "${titlePart}"${authorPart}.

The page is ALREADY open — do NOT navigate anywhere. Read it with getFlattenDOM, then decide:
- If the page IS the beginning of ${label}'s actual prose content, call landHere.
- If it is NOT (a search engine, login wall, paywall, recaptcha, age gate, 404/error page, site homepage, table of contents / index, or a DIFFERENT piece of content), call rejectCandidate with a short reason.

Call landHere ONLY when the page is truly showing the start of ${label}'s prose.`;
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

ONLY call abortChapter when you are CONFIDENT there is NO next-chapter link AND NO table-of-contents entry for chapter ${chapterNumber}. Before aborting, retry: re-read the page, look for a TOC toggle/menu, and try alternative controls several times. Calling abortChapter means chapter ${chapterNumber - 1} was the LAST chapter of the book.

Rules:
- Use only the tools provided.
- Do not call landHere until you are certain you are on chapter ${chapterNumber}'s beginning.`;
}

// --- Search-path judge (one candidate) --------------------------------------

/**
 * Run the minimal judge agent against the page already loaded in the crawl tab.
 * The agent never sees the candidate URL — it only reads the DOM and decides
 * landHere vs rejectCandidate. Bounded by `stepCountIs(4)` and the agent-level
 * step timeout; on reject / timeout / exhaustion the caller moves to the next
 * candidate. Returns true iff `landHere` fired (URL already written by it).
 */
async function judgeCandidate(
  novel: InternetNovel,
  ctx: InternetFetchContext,
  options: FetchChapterOptions,
  candidateIndex: number,
): Promise<boolean> {
  const label = contentLabel(options.nonNovelSource, ctx.chapterNumber);
  const result = streamText({
    model: complexModel(),
    system: buildJudgeSystemPrompt(
      novel,
      ctx.chapterNumber,
      options.nonNovelSource,
    ),
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
      stepCountIs(4),
    ],
    maxRetries: settingsService.settings.maxRetries,
    timeout: TIMEOUTS.actionExecution,
    abortSignal: ctx.abortSignal,
    experimental_context: ctx,
    experimental_telemetry: {
      isEnabled: settingsService.settings.langfuse.enabled,
      functionId: "entertainment-internet-judge",
      metadata: {
        threadId: ctx.threadId,
        chapterNumber: ctx.chapterNumber,
        candidateIndex,
      },
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
 */
async function landViaSearch(
  novel: InternetNovel,
  ctx: InternetFetchContext,
  options: FetchChapterOptions,
): Promise<void> {
  // 1) Gather candidates (RAM-only). [novel.source] if it's already a URL;
  //    otherwise one query via executeSearchQueries in a transient search session.
  let candidates: string[];
  if (isAbsoluteUrl(novel.source.trim())) {
    candidates = [novel.source.trim()];
  } else {
    const plan = buildSearchPlan(novel, ctx.chapterNumber);
    // executeSearchQueries creates/destroys its own tabs in this session, but
    // SessionTabService only tracks tabs for a session that has been activated
    // (createTab registers into `sessionStates[sessionId]` only if it exists).
    // Without activateSession, getTabsForSession returns [] → 0 candidates.
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
      );
      candidates = results.map((r) => r.url).filter((u) => !!u);
    } finally {
      // Restore the crawl session as active so the crawl tab is visible again.
      await sts.activateSession(ctx.sessionId);
    }
  }
  if (candidates.length === 0) {
    throw new Error(`No candidate URLs found for chapter ${ctx.chapterNumber}`);
  }
  logger.info("search candidates", {
    threadId: ctx.threadId,
    chapterNumber: ctx.chapterNumber,
    count: candidates.length,
  });

  // 2) Probe each candidate deterministically: navigate, then ask the judge.
  const tcs = TabControlService.getInstance();
  for (let i = 0; i < candidates.length; i++) {
    const candidateUrl = candidates[i];
    logger.debug("probing candidate", {
      threadId: ctx.threadId,
      chapterNumber: ctx.chapterNumber,
      index: i,
      url: candidateUrl,
    });
    try {
      await tcs.navigateTo(ctx.activeTabId, candidateUrl);
    } catch (err) {
      logger.warn("navigate to candidate failed; trying next", {
        index: i,
        url: candidateUrl,
        err,
      });
      continue;
    }
    if (await judgeCandidate(novel, ctx, options, i)) return; // landHere wrote the URL
  }
  throw new Error(
    `Could not land on chapter ${ctx.chapterNumber} (no candidate matched)`,
  );
}

/**
 * Advance path — from the carried-over crawl tab, click next-chapter / TOC to
 * reach chapter N. Recovery: if the tab isn't on a real page (e.g. after
 * restart), re-navigate to `source_chapters(N-1).url` first — the sole DB-URL
 * read. An explicit `abortChapter` → `FinalChapterError` (N-1 was the last);
 * step exhaustion → generic error (transient, not finality).
 */
async function landViaAdvance(
  novel: InternetNovel,
  ctx: InternetFetchContext,
): Promise<void> {
  const sts = SessionTabService.getInstance();
  const tab = sts.getTab(ctx.activeTabId);
  const current =
    tab?.webContents && !tab.webContents.isDestroyed() ?
      tab.webContents.getURL()
    : "";
  if (!/^https?:\/\//i.test(current)) {
    const prev = entertainmentService.getSourceChapter(
      ctx.threadId,
      ctx.chapterNumber - 1,
    );
    const prevUrl = prev?.url;
    if (!prevUrl) {
      throw new Error(
        `No anchor URL for previous chapter ${ctx.chapterNumber - 1}`,
      );
    }
    logger.info("recovery re-anchor", {
      threadId: ctx.threadId,
      chapterNumber: ctx.chapterNumber,
      prevUrl,
    });
    await TabControlService.getInstance().navigateTo(ctx.activeTabId, prevUrl);
  }

  const result = streamText({
    model: complexModel(),
    system: buildAdvanceSystemPrompt(novel, ctx.chapterNumber),
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
    },
    stopWhen: [
      hasSuccessfulToolResult("landHere"),
      hasSuccessfulToolResult("abortChapter"),
      stepCountIs(12),
    ],
    maxRetries: settingsService.settings.maxRetries,
    timeout: TIMEOUTS.actionExecution,
    abortSignal: ctx.abortSignal,
    experimental_context: ctx,
    experimental_telemetry: {
      isEnabled: settingsService.settings.langfuse.enabled,
      functionId: "entertainment-internet-land",
      metadata: { threadId: ctx.threadId, chapterNumber: ctx.chapterNumber },
    },
  });

  const steps = await result.steps;
  const toolResults = steps.flatMap((s) => s.toolResults ?? []);
  if (
    toolResults.some(
      (tr) => tr.toolName === "landHere" && tr.type === "tool-result",
    )
  ) {
    return; // url already written by landHere
  }
  const aborted = toolResults.some(
    (tr) => tr.toolName === "abortChapter" && tr.type === "tool-result",
  );
  if (aborted) throw new FinalChapterError();
  throw new Error(`Could not advance to chapter ${ctx.chapterNumber}`);
}

// --- Phase 1 entry ----------------------------------------------------------

/**
 * Phase 1 — land the crawl tab on the chapter's beginning + persist the URL +
 * detect finality. Two paths, picked by chapter number / `useSearch`:
 *   - search  (chapter 1 or a retried errored chapter): deterministic candidate
 *     loop — the orchestrator navigates each candidate via
 *     `TabControlService.navigateTo` and a minimal judge agent reads + decides
 *     land/reject (candidates never enter the prompt).
 *   - advance (normal N>1): one agent loop clicks next-chapter / TOC from the
 *     carried-over tab.
 *
 * Outcome: `landHere` writes `url`; on success the tab is left on chapter N's
 * beginning for phase 2. Advance-path `abortChapter` → `FinalChapterError`
 * (N-1 was the last). Anything else throws a generic error. Timeouts live at
 * the agent level (per `streamText` call), not the scheduler.
 */
export async function landOnChapter(
  novel: InternetNovel,
  ctx: InternetFetchContext,
  options: FetchChapterOptions,
): Promise<void> {
  const useSearch = ctx.chapterNumber === 1 || options.useSearch === true;
  if (useSearch) {
    await landViaSearch(novel, ctx, options);
  } else {
    await landViaAdvance(novel, ctx);
  }
}
