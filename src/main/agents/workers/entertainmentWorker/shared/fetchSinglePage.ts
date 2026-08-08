/**
 * Single-page fetcher for NON-NOVEL internet sources (a long post, an email
 * thread, an article — one continuous piece, not a chaptered novel).
 *
 * Unlike the chaptered fetcher (`internetFetch`), this does NOT loop chapters,
 * advance, or detect a final chapter. It lands ONCE — either by navigating
 * directly to `novel.source` when it's an absolute URL, or by running a single
 * search query to discover the page URL — then extracts the WHOLE page's prose
 * into ONE `source_chapters` row (always `chapterNumber = 1`, the single output
 * it produces).
 *
 * Reuses only the LEAF tools of the chaptered fetcher:
 *  - `getFlattenDOMTool` + `clickElementTool` (DOM read / pagination click)
 *  - `executeSearchQueries` (URL discovery when `novel.source` isn't a URL)
 *  - `SessionTabService` / `TabControlService` / entertainment services
 *    (`entertainmentFrontendService` reads, `entertainmentBackendService` writes)
 *
 * It deliberately does NOT import `fetchInternetChapter` / `landOnChapter` /
 * `extractChapter` — those encode chapter-LOOP logic (finality detection,
 * candidate judging, advance) that is irrelevant to a single continuous piece.
 */

import { streamText, stepCountIs, tool } from "ai";
import { z } from "zod";
import log from "electron-log/main";
import { complexModel } from "@agents/providers";
import { hasSuccessfulToolResult, TIMEOUTS } from "@agents/utils";
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

const logger = log.scope("Dehydrate:Pipeline3:FetchSinglePage");

/**
 * Context injected into the extract agent's tool via `experimental_context` —
 * the zero-token "context API" pattern: `threadId` + `chapterNumber` (always 1
 * here) reach the tool's business logic alongside the browser `sessionId` +
 * `activeTabId` the existing DOM/interactive tools expect, without ever
 * appearing in the prompt.
 */
interface SinglePageFetchContext {
  sessionId: string;
  activeTabId: string;
  threadId: string;
  /** Always 1 — a non-novel source produces exactly one source row. */
  chapterNumber: number;
  abortSignal?: AbortSignal;
}

/**
 * `saveContent` — the extract agent's terminal tool and the ONLY way it
 * delivers the page's full prose. Modeled on phase2Extract's
 * `saveChapterContentTool`, but pinned to `chapterNumber = 1` (this pipeline
 * has one source row). `title` is optional/null: a post/article may not carry a
 * usable title. `hasSuccessfulToolResult("saveContent")` then stops the stream,
 * so this single call both persists the result and terminates the agent.
 */
const saveContentTool = tool({
  description:
    "Call this with the COMPLETE prose of the page (the whole post / article / thread) once you have read all of it.",
  inputSchema: z.object({
    content: z
      .string()
      .min(1)
      .describe("The full prose of this page, joined in reading order."),
    title: z
      .string()
      .nullable()
      .describe("A short title for the post/article if visible, else null."),
  }),
  execute: async (input, { experimental_context }) => {
    const ctx = experimental_context as SinglePageFetchContext;
    entertainmentBackendService.updateSourceChapter(
      ctx.threadId,
      ctx.chapterNumber,
      {
        content: input.content,
        title: input.title,
      },
    );
    logger.info("content saved", {
      threadId: ctx.threadId,
      contentLen: input.content.length,
    });
    return { saved: true };
  },
});

/**
 * System prompt for the single-page extract agent. The crawl tab is already on
 * the target page (landed by the caller), so this does NO URL discovery — it
 * reads the page and dumps the full prose. It may follow "next PAGE" pagination
 * while the SAME post continues, but must NOT follow links to OTHER posts.
 */
function buildExtractSystemPrompt(novel: InternetNovel): string {
  const titlePart = novel.title.trim() || "the requested page";
  return `You are an extraction agent controlling a browser via tools. The browser is ALREADY showing the page to extract — do NOT navigate to a different URL to find it.

Your job: extract the COMPLETE prose of the page and save it.

The page is "${titlePart}" — a single continuous piece of content (a long post, an email thread, an article, a forum thread, etc.), NOT a chaptered novel.

Steps:
1. Call getFlattenDOM to read the current page.
2. Extract the page's actual prose — the body content / narrative text — skipping ads, navigation, sidebars, related links, comments sections, "please log in" banners, and other page chrome.
3. Some sites split ONE post across multiple pages with a "next page" / "下一页" control. If the SAME post continues on a next PAGE, call clickElement on the next-page control, then call getFlattenDOM again and continue collecting.
4. Stop paginating when you reach the END of this single post. Do NOT follow links to OTHER posts / articles / threads — those are separate pieces, not a continuation.
5. Once you have the COMPLETE prose of this single post, call saveContent with the full text joined in reading order and a short title (or null).

Rules:
- Output prose only — no commentary, no markdown headings, no "end of post" markers.
- Call saveContent exactly once, with everything.`;
}

/**
 * Find-or-create the thread's crawl tab (mirrors internetFetch's `ensureCrawlTab`).
 * `activateSession` creates the session + an initial tab on first use; the tab
 * is reused for the read. Functional regardless of split-view visibility.
 */
async function ensureCrawlTab(sessionId: string): Promise<string> {
  const sts = SessionTabService.getInstance();
  await sts.activateSession(sessionId);
  const tabId = sts.getTabsForSession(sessionId)[0];
  // Point the session's active-tab pointer at our crawl tab so split-view
  // visibility (if enabled) tracks it. Tools target the tab via the
  // `activeTabId` passed in experimental_context, not this pointer.
  const state = sts.getSessionTabState(sessionId);
  if (state) state.activeTabId = tabId;
  return tabId;
}

/**
 * Land the crawl tab on the page to extract. Two paths:
 *  - `novel.source` is an absolute URL → navigate the tab to it directly.
 *  - otherwise → run ONE search query via `executeSearchQueries` to discover the
 *    page URL, take the first result, navigate to it.
 * Returns true if the tab is now on a landable page; false if no URL could be
 * found/navigated-to.
 */
async function landOnPage(
  novel: InternetNovel,
  ctx: SinglePageFetchContext,
): Promise<boolean> {
  const tcs = TabControlService.getInstance();
  const source = novel.source.trim();

  if (/^https?:\/\//i.test(source)) {
    // Direct URL — navigate the crawl tab straight to it.
    try {
      await tcs.navigateTo(ctx.activeTabId, source);
      return true;
    } catch (err) {
      logger.warn("navigate to source URL failed", { url: source, err });
      return false;
    }
  }

  // Search path — one query, take the first result URL. executeSearchQueries
  // creates/destroys its own tabs in its own session, but SessionTabService only
  // tracks tabs for a session that has been activated (mirrors phase1Land's
  // landViaSearch). After it runs, re-activate the crawl session so the crawl
  // tab is current again.
  const base = novel.title.trim() || source;
  const query = [base, novel.author?.trim()].filter(Boolean).join(" ");
  const plan: ResearchPlan = {
    id: `ent-fetch3-plan-${ctx.threadId}`,
    title: base,
    description: `Find the page for: ${base}`,
    queries: [
      {
        id: `ent-fetch3-plan-${ctx.threadId}-q0`,
        query,
        focus: `${base} — the page where this post/article begins`,
      },
    ],
  };
  const searchSessionId = `ent-search3-${ctx.threadId}`;
  const sts = SessionTabService.getInstance();
  await sts.activateSession(searchSessionId);
  let candidates: string[];
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
    // Restore the crawl session as active so the crawl tab is current again.
    await sts.activateSession(ctx.sessionId);
  }

  if (candidates.length === 0) {
    logger.warn("no candidate URL found for single page", {
      threadId: ctx.threadId,
    });
    return false;
  }
  logger.info("search candidate", {
    threadId: ctx.threadId,
    count: candidates.length,
    url: candidates[0],
  });
  try {
    await tcs.navigateTo(ctx.activeTabId, candidates[0]);
    return true;
  } catch (err) {
    logger.warn("navigate to candidate failed", { url: candidates[0], err });
    return false;
  }
}

/**
 * Extract the WHOLE page prose with a simple agent loop. The crawl tab is
 * already on the page (caller landed it), so this reads it (getFlattenDOM),
 * clicks next-PAGE if the same post continues (clickElement), and dumps the
 * full prose via `saveContent`. Returns true iff the agent called `saveContent`
 * (content already written by the tool). Step exhaustion without a save → false.
 */
async function extractPage(
  novel: InternetNovel,
  ctx: SinglePageFetchContext,
): Promise<boolean> {
  const result = streamText({
    model: complexModel().model,
    system: buildExtractSystemPrompt(novel),
    messages: [
      {
        role: "user",
        content:
          "Read this page's complete prose (following next-PAGE if the same post continues) and save it.",
      },
    ],
    tools: {
      getFlattenDOM: getFlattenDOMTool,
      clickElement: clickElementTool,
      saveContent: saveContentTool,
    },
    stopWhen: [hasSuccessfulToolResult("saveContent"), stepCountIs(20)],
    maxRetries: settingsService.settings.maxRetries,
    timeout: TIMEOUTS.actionExecution,
    abortSignal: ctx.abortSignal,
    experimental_context: ctx,
    experimental_telemetry: {
      isEnabled: settingsService.settings.langfuse.enabled,
      functionId: "entertainment-pipeline3-fetch-single-page",
      metadata: { threadId: ctx.threadId },
    },
  });
  const steps = await result.steps;
  return steps
    .flatMap((s) => s.toolResults ?? [])
    .some((tr) => tr.toolName === "saveContent" && tr.type === "tool-result");
}

/**
 * Acquire a single non-novel internet page and own its `source_chapters` row
 * lifecycle end to end. Marks the row `"fetching"` up front (inserting a fresh
 * row or resetting a stale one), lands the crawl tab on the page, then extracts
 * the whole-page prose into that one row (always `chapterNumber = 1`).
 *
 * Returns the terminal status — never throws for expected outcomes:
 *  - `"fetched"` — the page prose was acquired; the caller may proceed to rewrite.
 *  - `"error"` — no URL could be landed, or extraction failed / exhausted its
 *    step budget without saving. The row is marked `"error"`.
 */
export async function fetchSinglePage(
  novel: InternetNovel,
  threadId: string,
): Promise<"fetched" | "error"> {
  // There is always exactly one source row at chapterNumber 1.
  const chapterNumber = 1;

  // Own the source-row lifecycle up front (insert fresh or reset stale).
  const prior = entertainmentFrontendService.getSourceChapter(
    threadId,
    chapterNumber,
  );
  if (!prior) {
    entertainmentBackendService.insertSourceChapter({
      threadId,
      chapterNumber,
      status: "fetching",
    });
  } else {
    entertainmentBackendService.updateSourceChapter(threadId, chapterNumber, {
      status: "fetching",
    });
  }

  const sessionId = `ent-fetch-${threadId}`;
  const tabId = await ensureCrawlTab(sessionId);
  const ctx: SinglePageFetchContext = {
    sessionId,
    activeTabId: tabId,
    threadId,
    chapterNumber,
  };

  logger.info("fetch single page", { threadId });

  try {
    const landed = await landOnPage(novel, ctx);
    if (!landed) {
      logger.warn("could not land on single page", { threadId });
      entertainmentBackendService.updateSourceChapter(threadId, chapterNumber, {
        status: "error",
      });
      return "error";
    }
    const saved = await extractPage(novel, ctx);
    if (!saved) {
      logger.error("single-page extract did not save content", { threadId });
      entertainmentBackendService.updateSourceChapter(threadId, chapterNumber, {
        status: "error",
      });
      return "error";
    }
    entertainmentBackendService.updateSourceChapter(threadId, chapterNumber, {
      status: "fetched",
    });
    return "fetched";
  } catch (err) {
    logger.error("single-page fetch failed", { threadId, err });
    entertainmentBackendService.updateSourceChapter(threadId, chapterNumber, {
      status: "error",
    });
    return "error";
  }
}
