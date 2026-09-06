/**
 * Pipeline 3's fetcher — NON-CHAPTERED internet sources (a long post, an
 * email thread, an article — one continuous piece, not a chaptered novel).
 *
 * This module does NOT loop chapters, advance, or detect a final chapter. It
 * lands ONCE by navigating directly to `novel.source` — the source MUST be a
 * direct content link (validated http(s) URL; the wizard enforces this) —
 * then extracts the WHOLE page's prose into ONE `source_chapters` row (always
 * `chapterNumber = 1`, the single output it produces). The book this row
 * belongs to has exactly one chapter: never split, never re-chaptered —
 * 「开启后，阅读器不会对当前内容进行分章处理」.
 *
 * Reuses only the LEAF tools:
 *  - `getFlattenDOMTool` + `clickElementTool` (DOM read / pagination click)
 *  - `SessionTabService` / `TabControlService` / entertainment services
 *    (`entertainmentFrontendService` reads, `entertainmentBackendService` writes)
 */

import { streamText, isStepCount, tool } from "ai";
import { z } from "zod";
import log from "electron-log/main";
import { complexModel } from "@agents/providers";
import { hasSuccessfulToolResult, TIMEOUTS } from "@agents/utils";
import {
  settingsService,
  entertainmentBackendService,
  SessionTabService,
  TabControlService,
} from "@/services";
import { getFlattenDOMTool } from "@agents/tools/DOMTools";
import { clickElementTool } from "@agents/tools/InteractiveTools";
import { isValidHttpUrl, type InternetNovel } from "@shared";
import { buildUserInteractionWallBlock } from "../shared/crawlWallPrompt";

const logger = log.scope("Dehydrate:SinglePage:FetchSinglePage");

/**
 * Context injected into the extract agent's tool via `toolsContext` —
 * the zero-token "context API" pattern: `threadId` + `chapterNumber` (always 1
 * here) reach the tool's business logic alongside the browser `sessionId` +
 * `activeTabId` the existing DOM/interactive tools expect, without ever
 * appearing in the prompt.
 */
interface SinglePageFetchContext {
  sessionId: string;
  activeTabId: string;
  threadId: string;
  /** Always 1 — a non-chaptered source produces exactly one source row. */
  chapterNumber: number;
  abortSignal?: AbortSignal;
}

/**
 * `saveContent` — the extract agent's terminal tool and the ONLY way it
 * delivers the page's full prose. Pinned to `chapterNumber = 1` (this
 * pipeline has one source row). `title` is optional/null: a post/article may
 * not carry a usable title. `hasSuccessfulToolResult("saveContent")` then
 * stops the stream, so this single call both persists the result and
 * terminates the agent.
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
  contextSchema: z.object({
    sessionId: z.string(),
    activeTabId: z.string(),
    threadId: z.string(),
    chapterNumber: z.number(),
  }),
  execute: async (input, { context: ctx }) => {
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

${buildUserInteractionWallBlock(
  "do NOT call saveContent and do NOT treat the wall as the post's end: saving would commit a truncated page. Simply stop — the fetch is marked failed and retried on a different site",
)}

Rules:
- Output prose only — no commentary, no markdown headings, no "end of post" markers.
- Call saveContent exactly once, with everything.`;
}
/**
 * Find-or-create the thread's crawl tab. `activateSession` creates the session
 * + an initial tab on first use; the tab is then reused for the read (there is
 * exactly one acquisition, so one tab serves the whole pipeline). Functional
 * regardless of split-view visibility: the WebContentsView + CDP/DOM services
 * work hidden.
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


/** Release the crawl tab once the single page is acquired (book end). */
async function destroyCrawlTab(sessionId: string): Promise<void> {
  const sts = SessionTabService.getInstance();
  await sts.destroyAllTabs(sessionId);
}

/**
 * Land the crawl tab on the page to extract by navigating directly to
 * `novel.source` (a validated http(s) URL — the wizard blocks anything else).
 * Returns true if the tab is now on the page; false when the source isn't a
 * URL (re-configure the thread with a content link) or navigation fails —
 * the caller's error path marks the row `error`.
 */
async function landOnPage(
  novel: InternetNovel,
  ctx: SinglePageFetchContext,
): Promise<boolean> {
  const tcs = TabControlService.getInstance();
  const source = novel.source.trim();

  if (!isValidHttpUrl(source)) {
    logger.warn(
      "non-chaptered source is not a URL — re-configure the thread with a content link",
      { threadId: ctx.threadId },
    );
    return false;
  }

  try {
    await tcs.navigateTo(ctx.activeTabId, source);
    return true;
  } catch (err) {
    logger.warn("navigate to source URL failed", { url: source, err });
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
    instructions: buildExtractSystemPrompt(novel),
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
    stopWhen: [hasSuccessfulToolResult("saveContent"), isStepCount(20)],
    maxRetries: settingsService.settings.maxRetries,
    timeout: TIMEOUTS.actionExecution,
    abortSignal: ctx.abortSignal,
    toolsContext: { getFlattenDOM: ctx, clickElement: ctx, saveContent: ctx },
    telemetry: {
      isEnabled: settingsService.settings.langfuse.enabled,
      functionId: "entertainment-pipeline3-fetch-single-page",
    },
  });
  const steps = await result.steps;
  return steps
    .flatMap((s) => s.toolResults ?? [])
    .some((tr) => tr.toolName === "saveContent" && tr.type === "tool-result");
}

/**
 * Acquire a single non-chaptered internet page and own its `source_chapters`
 * row lifecycle end to end. Marks the row `"fetching"` up front (inserting a
 * fresh row or resetting a stale one), lands the crawl tab on the page, then
 * extracts the whole-page prose into that one row (always `chapterNumber = 1`).
 * On success the crawl tab is released (this fetch IS the book's end); on
 * `"error"` it is kept — a retry may reuse the tab.
 *
 * Returns the terminal status — never throws for expected outcomes:
 *  - `"fetched"` — the page prose was acquired; the caller may proceed to rewrite.
 *  - `"error"` — no URL could be landed, extraction failed / exhausted its
 *    step budget without saving, or `abortSignal` aborted the run. The row is
 *    marked `"error"`.
 */
export async function fetchSinglePage(
  novel: InternetNovel,
  threadId: string,
  abortSignal?: AbortSignal,
): Promise<"fetched" | "error"> {
  // There is always exactly one source row at chapterNumber 1.
  const chapterNumber = 1;

  // Own the source-row lifecycle up front (insert fresh or reset stale).
  entertainmentBackendService.markSourceChapterFetching({
    threadId,
    chapterNumber,
  });

  const sessionId = `ent-fetch-${threadId}`;
  const tabId = await ensureCrawlTab(sessionId);
  const ctx: SinglePageFetchContext = {
    sessionId,
    activeTabId: tabId,
    threadId,
    chapterNumber,
    abortSignal,
  };

  logger.info("fetch single page", { threadId });

  try {
    if (!(await landOnPage(novel, ctx))) {
      throw new Error("could not land on single page");
    }
    if (!(await extractPage(novel, ctx))) {
      throw new Error("single-page extract did not save content");
    }
    entertainmentBackendService.updateSourceChapter(threadId, chapterNumber, {
      status: "fetched",
    });
    // Book end — this row is the whole book. Release the crawl tab.
    await destroyCrawlTab(sessionId);
    return "fetched";
  } catch (err) {
    logger.error("single-page fetch failed", { threadId, err });
    entertainmentBackendService.updateSourceChapter(threadId, chapterNumber, {
      status: "error",
    });
    return "error";
  }
}
