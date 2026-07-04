import { streamText, stepCountIs, tool } from "ai";
import { z } from "zod";
import { createIdGenerator } from "@ai-sdk/provider-utils";
import log from "electron-log/main";
import { complexModel } from "@agents/providers";
import { hasSuccessfulToolResult, TIMEOUTS } from "@agents/utils";
import { settingsService, entertainmentService, SessionTabService } from "@/services";
import { navigateTool } from "@agents/tools/TabControlTools";
import { getFlattenDOMTool } from "@agents/tools/DOMTools";
import { clickElementTool } from "@agents/tools/InteractiveTools";
import { executeSearchQueries } from "@agents/workers/browserWorker/browser-research/search-agent";
import type { ResearchPlan } from "@agents/workers/browserWorker/browser-research/planner";
import type { InternetNovel } from "@shared";
import type { FetchChapterOptions, InternetFetchContext } from "./index";
import { FinalChapterError } from "./index";

const logger = log.scope("Dehydrate:InternetFetch:Phase1");
const generateId = createIdGenerator({ prefix: "call", size: 24 });

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
 * `abortChapter` — phase 1's failure terminal. Meaning depends on the path
 * (the orchestrator maps it): on the search path it is a generic "could not
 * land" error; on the advance path it means "no next chapter exists → the
 * previous chapter was the LAST one" (→ `FinalChapterError`).
 */
const abortChapterTool = tool({
  description:
    "Call this only per the prompt's exact abort condition (you could not reach the target chapter). Provide a short reason.",
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

function contentLabel(nonNovelSource: boolean, chapterNumber: number): string {
  return nonNovelSource ? "the post/article" : `chapter ${chapterNumber}`;
}

function buildSearchSystemPrompt(
  novel: InternetNovel,
  chapterNumber: number,
  nonNovelSource: boolean,
): string {
  const label = contentLabel(nonNovelSource, chapterNumber);
  const titlePart = novel.title.trim() || "the requested novel";
  const authorPart = novel.author?.trim() ? ` by ${novel.author.trim()}` : "";
  return `You are a web-navigation agent controlling a browser via tools. Your goal is to land on the page where a specific piece of content begins.

Target content: ${label} of "${titlePart}"${authorPart}.

You will be given a list of candidate URLs from a web search. For EACH candidate, in order:
1. Call navigate with the candidate URL to open it.
2. Call getFlattenDOM to read the loaded page.
3. Judge whether THIS page is the actual beginning of the target content's prose. It must be the real content — NOT a search engine, login wall, paywall, recaptcha, age gate, 404/error page, site homepage, table of contents/index, or a DIFFERENT piece of content.

When the page is the beginning of ${label}, call landHere.

If you have checked every candidate and NONE is the target content's beginning (all inaccessible, wrong, or non-content), call abortChapter with a short reason.

Rules:
- Call landHere ONLY when the page is actually showing the start of ${label}.
- Use only the tools provided. Do not invent or guess URLs.`;
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

// --- Phase 1 entry ----------------------------------------------------------

/**
 * Phase 1 — land the crawl tab on the chapter's beginning + persist the URL +
 * detect finality. One agent loop (tools: navigate, getFlattenDOM, clickElement,
 * landHere, abortChapter). Two paths, picked by chapter number / `useSearch`:
 *   - search  (chapter 1 or a retried errored chapter): build candidates via
 *     `executeSearchQueries` (or `[novel.source]` when it's a URL), then let the
 *     agent probe them.
 *   - advance (normal N>1): from the carried-over tab, click next-chapter / TOC.
 *
 * Recovery: if the advance-path tab isn't on a real page (e.g. after restart),
 * re-navigate to `source_chapters(N-1).url` first — the sole DB-URL read.
 *
 * Outcome: `landHere` writes `url`; on success the tab is left on chapter N's
 * beginning for phase 2. Advance-path `abortChapter` → `FinalChapterError`
 * (N-1 was the last). Anything else throws a generic error.
 */
export async function landOnChapter(
  novel: InternetNovel,
  ctx: InternetFetchContext,
  options: FetchChapterOptions,
): Promise<void> {
  const useSearch = ctx.chapterNumber === 1 || options.useSearch === true;

  // Recovery (advance path): re-anchor on the previous chapter's URL if the
  // crawl tab has no real page loaded.
  if (!useSearch) {
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
      await navigateTool.execute!(
        { url: prevUrl },
        {
          toolCallId: generateId(),
          messages: [],
          experimental_context: ctx,
        },
      );
    }
  }

  // Build candidates (search path) + the prompt pair.
  let userMessage: string;
  let system: string;
  if (useSearch) {
    let candidates: string[];
    if (isAbsoluteUrl(novel.source.trim())) {
      candidates = [novel.source.trim()];
    } else {
      const plan = buildSearchPlan(novel, ctx.chapterNumber);
      const results = await executeSearchQueries(
        plan,
        `ent-search-${ctx.threadId}`,
        "",
        { write() {} },
        undefined,
        ctx.abortSignal,
      );
      candidates = results.map((r) => r.url).filter((u) => !!u);
    }
    if (candidates.length === 0) {
      throw new Error(
        `No candidate URLs found for chapter ${ctx.chapterNumber}`,
      );
    }
    logger.info("search candidates", {
      threadId: ctx.threadId,
      chapterNumber: ctx.chapterNumber,
      count: candidates.length,
    });
    system = buildSearchSystemPrompt(
      novel,
      ctx.chapterNumber,
      options.nonNovelSource,
    );
    userMessage = `Candidate URLs (probe them in order):\n${candidates
      .map((u, i) => `${i + 1}. ${u}`)
      .join("\n")}\n\nLand on the beginning of ${contentLabel(options.nonNovelSource, ctx.chapterNumber)}.`;
  } else {
    system = buildAdvanceSystemPrompt(novel, ctx.chapterNumber);
    userMessage = `Reach the beginning of chapter ${ctx.chapterNumber} from the current page.`;
  }

  const result = streamText({
    model: complexModel(),
    system,
    messages: [{ role: "user", content: userMessage }],
    tools: {
      navigate: navigateTool,
      getFlattenDOM: getFlattenDOMTool,
      clickElement: clickElementTool,
      landHere: landHereTool,
      abortChapter: abortChapterTool,
    },
    stopWhen: [
      hasSuccessfulToolResult("landHere"),
      hasSuccessfulToolResult("abortChapter"),
      stepCountIs(15),
    ],
    maxRetries: settingsService.settings.maxRetries,
    timeout: TIMEOUTS.actionExecution,
    abortSignal: ctx.abortSignal,
    experimental_context: ctx,
    experimental_telemetry: {
      isEnabled: settingsService.settings.langfuse.enabled,
      functionId: "entertainment-internet-land",
      metadata: {
        threadId: ctx.threadId,
        chapterNumber: ctx.chapterNumber,
        path: useSearch ? "search" : "advance",
      },
    },
  });

  const steps = await result.steps;
  const toolResults = steps.flatMap((s) => s.toolResults ?? []);
  const landed = toolResults.some(
    (tr) => tr.toolName === "landHere" && tr.type === "tool-result",
  );
  if (landed) return; // url already written by landHere

  const aborted = toolResults.some(
    (tr) => tr.toolName === "abortChapter" && tr.type === "tool-result",
  );
  if (useSearch) {
    throw new Error(`Could not land on chapter ${ctx.chapterNumber}`);
  }
  // advance path: an explicit, confident abort means N-1 was the last chapter;
  // step exhaustion (no terminal tool) is a transient failure, not finality.
  if (aborted) throw new FinalChapterError();
  throw new Error(`Could not advance to chapter ${ctx.chapterNumber}`);
}
