/**
 * The five LLM agents of the chaptered internet fetch. Each agent is a
 * `streamText` loop with a terminal echo tool (the runner pattern from
 * pipeline3's fetchSinglePage) plus the shared browser leaf tools
 * (`getFlattenDOM` / `clickElement`) and `reportWall` — a wall reported by
 * ANY agent blacklists the host and rotates the site.
 *
 * The orchestrator (index.ts) navigates deterministically BEFORE each agent
 * runs and probes the DOM for wall markers in code; the agents own every
 * judgment that needs eyes (is this our book? which toc entry is chapter N?
 * is this the last chapter?).
 */

import { streamText, isStepCount, tool, type Tool } from "ai";
import { z } from "zod";
import log from "electron-log/main";
import { complexModel } from "@agents/providers";
import { hasSuccessfulToolResult, TIMEOUTS } from "@agents/utils";
import {
  settingsService,
  entertainmentBackendService,
  entertainmentFrontendService,
  SessionTabService,
} from "@/services";
import { getFlattenDOMTool } from "@agents/tools/DOMTools";
import { clickElementTool } from "@agents/tools/InteractiveTools";
import type { InternetNovel } from "@shared";
import { buildUserInteractionWallBlock } from "../../shared/crawlWallPrompt";
import {
  buildLandingRecoveryPrompt,
  type LandingRecoveryInput,
} from "./pure";
import { reportWallTool } from "./wallGuard";

const logger = log.scope("Dehydrate:InternetFetch");

/** Browser + book context every agent (and its tools) runs under. */
export interface Ctx {
  sessionId: string;
  activeTabId: string;
  threadId: string;
  chapterNumber: number;
  abortSignal?: AbortSignal;
}

/** One agent step's recorded tool result (wall detection scans these). */
interface AgentToolResult {
  toolName: string;
  output: unknown;
}

/**
 * Shared runner: one streamText call bounded by the agent's terminal tool
 * (first successful call stops the stream) and a step budget. Returns the
 * flat list of tool results so callers can discriminate outcomes and detect
 * `reportWall`.
 */
async function runAgent(params: {
  instructions: string;
  user: string;
  tools: Record<string, Tool>;
  ctx: Ctx;
  terminal: string;
  maxSteps: number;
  telemetryId: string;
}): Promise<AgentToolResult[]> {
  const toolsContext: Record<string, Ctx> = {};
  for (const name of Object.keys(params.tools)) {
    toolsContext[name] = params.ctx;
  }
  const result = streamText({
    model: complexModel().model,
    instructions: params.instructions,
    messages: [{ role: "user", content: params.user }],
    tools: params.tools as never,
    stopWhen: [hasSuccessfulToolResult(params.terminal), isStepCount(params.maxSteps)],
    maxRetries: settingsService.settings.maxRetries,
    timeout: TIMEOUTS.actionExecution,
    abortSignal: params.ctx.abortSignal,
    toolsContext: toolsContext as never,
    telemetry: {
      isEnabled: settingsService.settings.langfuse.enabled,
      functionId: params.telemetryId,
    },
  });
  const steps = await result.steps;
  return steps
    .flatMap((s) => s.toolResults ?? [])
    .filter((tr) => tr.type === "tool-result")
    .map((tr) => ({ toolName: tr.toolName, output: tr.output }));
}

/** Terminal tool results are the agent's verdict; find one by name. */
function terminalOutput(
  toolResults: AgentToolResult[],
  name: string,
): Record<string, unknown> | null {
  const found = toolResults.find((tr) => tr.toolName === name);
  return found != null && typeof found.output === "object" && found.output != null
    ? (found.output as Record<string, unknown>)
    : null;
}

/** Any reportWall in the results ⇒ the site is walled (reason from the tool). */
function wallReason(toolResults: AgentToolResult[]): string | null {
  const wall = toolResults.find((tr) => tr.toolName === "reportWall");
  if (wall == null) return null;
  const out = wall.output;
  return out != null && typeof out === "object" && "reason" in out &&
      typeof (out as Record<string, unknown>).reason === "string"
    ? (out as Record<string, unknown>).reason as string
    : "wall:unknown";
}

// ---------------------------------------------------------------------------
// 1. findTocAgent — is this candidate our book, and where is its toc?
// ---------------------------------------------------------------------------

/** Verdict of the toc-judgment agent. */
type FindTocOutcome =
  | { kind: "toc"; tocUrl: string }
  | { kind: "wrong-book" }
  | { kind: "wall"; reason: string }
  | { kind: "failed" };

/**
 * The browser is ALREADY on `entryUrl` (the orchestrator navigated + probed).
 * The agent decides (a) whether the page belongs to our book — title/author
 * must match; app-download pages, aggregators, and empty results are
 * wrong-book — and (b) whether we're on (or can reach) the book's
 * chapter-list/toc page. On `toc`, CODE reads the live post-redirect URL.
 */
export async function findTocAgent(
  ctx: Ctx,
  novel: InternetNovel,
  entryUrl: string,
): Promise<FindTocOutcome> {
  const reportTocJudgment = tool({
    description:
      "Report your final judgment about this site for the requested book.",
    inputSchema: z.object({
      verdict: z
        .enum(["toc", "wrong-book"])
        .describe(
          '"toc" = this site hosts our book and the browser is now on its chapter-list/table-of-contents page; "wrong-book" = this page/site is NOT our book (title/author mismatch, app-download page, aggregator, empty).',
        ),
      reason: z.string().describe("One short sentence justifying the verdict."),
    }),
    execute: async (input) => input,
  });

  const titlePart = novel.title.trim() || "the requested book";
  const instructions = `You are a site-judgment agent controlling a browser via tools. The browser is ALREADY on a candidate page — do NOT navigate to a different site to find the book.

The book you are looking for: "${titlePart}"${novel.author ? ` by ${novel.author}` : ""}.

Tasks, in order:
1. Decide if this page/site is OUR book: the page's title and author must match "${titlePart}"${novel.author ? ` / "${novel.author}"` : ""}. An app-download page, an aggregator listing many unrelated books, a search-results page, or an empty/error page is "wrong-book" — report it and stop.
2. If it IS our book but the current page is not the chapter list: find the site's own 目录 / 章节列表 / table-of-contents link and click it. If the chapter list is split across multiple pages, paginate through it. The browser must end up ON the book's chapter-list page.
3. Once the browser is on the book's chapter-list/toc page, call reportTocJudgment with verdict "toc".
4. If the page is NOT our book at all, call reportTocJudgment with verdict "wrong-book".

${buildUserInteractionWallBlock(
  "call reportWall immediately with the wall kind — never treat a walled page as a usable table of contents",
)}

Remember the paid-content rule: VIP / 会员 / 付费 / 订阅 / lock markers on ANY chapter or toc entry ANYWHERE on this site — even for chapters outside your task — mean this site will eventually lock ours. That is a wall: reportWall.`;

  const toolResults = await runAgent({
    instructions,
    user: `Judge the page the browser is on (${entryUrl}) for the book "${titlePart}".`,
    tools: {
      getFlattenDOM: getFlattenDOMTool,
      clickElement: clickElementTool,
      reportWall: reportWallTool,
      reportTocJudgment,
    },
    ctx,
    terminal: "reportTocJudgment",
    maxSteps: 25,
    telemetryId: "entertainment-internet-toc",
  });

  const wall = wallReason(toolResults);
  if (wall != null) return { kind: "wall", reason: wall };
  const verdict = terminalOutput(toolResults, "reportTocJudgment");
  if (verdict == null) return { kind: "failed" };
  if (verdict.verdict === "wrong-book") return { kind: "wrong-book" };
  // toc: read the live post-redirect URL from the tab — never a href string.
  const sts = SessionTabService.getInstance();
  const tab = sts.getTab(ctx.activeTabId);
  const tocUrl = tab?.webContents.getURL();
  if (!tocUrl) {
    logger.warn("toc verdict but no live tab URL", { threadId: ctx.threadId });
    return { kind: "failed" };
  }
  return { kind: "toc", tocUrl };
}

// ---------------------------------------------------------------------------
// 2. targetChapterAgent — open chapter n from the toc
// ---------------------------------------------------------------------------

/** Verdict of the target-chapter agent. */
type TargetChapterOutcome =
  | { kind: "landed" }
  | { kind: "wrong-landing"; title: string | null; url: string }
  | { kind: "wall"; reason: string }
  | { kind: "failed" };

/**
 * The browser is ALREADY on the toc (the orchestrator navigated + probed).
 * The agent opens the toc entry for chapter `n` — located by LIST ORDER,
 * site numerals advisory (prologues/author notes shift them) — paginating
 * the list as needed, then confirms the reading page really is chapter n.
 * A wrong landing reports the landed page's title; the orchestrator retries
 * with `buildLandingRecoveryPrompt`.
 */
export async function targetChapterAgent(
  ctx: Ctx,
  novel: InternetNovel,
  n: number,
  tocUrl: string,
  recovery?: LandingRecoveryInput,
): Promise<TargetChapterOutcome> {
  const reportLandedChapter = tool({
    description:
      "Report which chapter the browser has landed on after opening a toc entry.",
    inputSchema: z.object({
      verdict: z
        .enum(["target", "other"])
        .describe(
          '"target" = this reading page IS chapter ' + n + '; "other" = it is a DIFFERENT chapter.',
        ),
      title: z
        .string()
        .nullable()
        .describe("The reading page's own chapter title, or null if none."),
      chapterLabel: z
        .string()
        .nullable()
        .describe(
          'The chapter label shown on the page (e.g. "第42章"), or null.',
        ),
    }),
    execute: async (input) => input,
  });

  const titlePart = novel.title.trim() || "the requested book";
  const instructions = `You are a chapter-navigation agent controlling a browser via tools. The browser is ALREADY on the book's table-of-contents page — do NOT navigate elsewhere by URL.

The book: "${titlePart}"${novel.author ? ` by ${novel.author}` : ""}. Your target: chapter ${n} of this book.

Steps:
1. Read the toc (getFlattenDOM). Locate the entry for chapter ${n} BY LIST ORDER — the site's printed chapter numbers are ADVISORY: prologues, 楔子, author notes, or extra chapters may shift the numbering. Count entries in reading order to find the ${n}-th chapter entry.
2. If the toc is paginated and the entry is beyond the current page, click through the list's pagination until you reach it.
3. Click the entry. The browser lands on a reading page.
4. Confirm what you landed on: it must be chapter ${n} of "${titlePart}" — check its position in the book's sequence and its title pattern. If it IS chapter ${n}, call reportLandedChapter with verdict "target".
5. If the page is a DIFFERENT chapter, call reportLandedChapter with verdict "other" plus the page's own title/label — do NOT try more clicking after that.

${buildUserInteractionWallBlock(
  "call reportWall immediately — never report a walled or half-loaded page as the target chapter",
)}

Remember: VIP / 会员 / 付费 / 订阅 / lock markers on ANY toc entry — including entries before/after chapter ${n} or for other books — are a wall. reportWall.`;

  const user = recovery ?
    buildLandingRecoveryPrompt(recovery)
  : `Open chapter ${n} of "${titlePart}" from the table of contents (${tocUrl}) and report what you land on.`;

  const toolResults = await runAgent({
    instructions,
    user,
    tools: {
      getFlattenDOM: getFlattenDOMTool,
      clickElement: clickElementTool,
      reportWall: reportWallTool,
      reportLandedChapter,
    },
    ctx,
    terminal: "reportLandedChapter",
    maxSteps: 25,
    telemetryId: "entertainment-internet-target",
  });

  const wall = wallReason(toolResults);
  if (wall != null) return { kind: "wall", reason: wall };
  const verdict = terminalOutput(toolResults, "reportLandedChapter");
  if (verdict == null) return { kind: "failed" };
  if (verdict.verdict === "target") return { kind: "landed" };
  const sts = SessionTabService.getInstance();
  const url = sts.getTab(ctx.activeTabId)?.webContents.getURL() ?? "";
  const title =
    typeof verdict.title === "string" ? verdict.title : null;
  return { kind: "wrong-landing", title, url };
}

// ---------------------------------------------------------------------------
// 3. advanceAgent — 下一章 from the previous chapter's page
// ---------------------------------------------------------------------------

/** Verdict of the advance agent. */
type AdvanceOutcome =
  | { kind: "landed" }
  | { kind: "no-next" }
  | { kind: "wall"; reason: string }
  | { kind: "failed" };

/**
 * The browser is ALREADY on `prevUrl` (chapter n-1's saved page). The agent
 * walks any within-chapter 下一页 pagination to the chapter's true end, then
 * clicks 下一章 and confirms the landing is the next chapter. `no-next` at
 * the chapter's true end hands the orchestrator to the finality proof.
 */
export async function advanceAgent(
  ctx: Ctx,
  novel: InternetNovel,
  n: number,
  prevUrl: string,
): Promise<AdvanceOutcome> {
  const reportAdvance = tool({
    description: "Report the outcome of the next-chapter advance.",
    inputSchema: z.object({
      verdict: z.enum(["landed", "no-next"]),
      title: z
        .string()
        .nullable()
        .describe(
          'The landed page\'s chapter title (for "landed"), or null.',
        ),
    }),
    execute: async (input) => input,
  });

  const titlePart = novel.title.trim() || "the requested book";
  const instructions = `You are a reading-flow agent controlling a browser via tools. The browser is ALREADY on the saved page of chapter ${n - 1} of "${titlePart}" — do NOT navigate by URL.

Your job: advance to chapter ${n} — the chapter that comes AFTER this one in the book's reading order.

Steps:
1. Read the page (getFlattenDOM).
2. If the CHAPTER itself continues on a next PAGE (a 下一页 / next-page pager WITHIN the chapter), click 下一页 and repeat until you reach the chapter's true end. Do NOT confuse 下一页 (page pager) with the next CHAPTER control.
3. At the chapter's true end, find the next-CHAPTER control — 下一章 / 下一章：… / next chapter — and click it.
4. Confirm the landing is really the NEXT chapter of "${titlePart}" (its title/label follows the previous chapter's, not a re-render of the same page).
5. Landed on the next chapter → reportAdvance verdict "landed" with its title.
6. If the page truly has NO next-chapter control at the chapter's end (the book ends here), reportAdvance verdict "no-next".

${buildUserInteractionWallBlock(
  "call reportWall immediately — a wall is never the end of the book, never \"no-next\"",
)}

Remember: VIP / 会员 / 付费 / lock markers on the next chapter's entry or anywhere on the page are a wall. reportWall.`;

  const toolResults = await runAgent({
    instructions,
    user: `From the current page (${prevUrl}, chapter ${n - 1} of "${titlePart}"), advance to chapter ${n} and report the outcome.`,
    tools: {
      getFlattenDOM: getFlattenDOMTool,
      clickElement: clickElementTool,
      reportWall: reportWallTool,
      reportAdvance,
    },
    ctx,
    terminal: "reportAdvance",
    maxSteps: 25,
    telemetryId: "entertainment-internet-advance",
  });

  const wall = wallReason(toolResults);
  if (wall != null) return { kind: "wall", reason: wall };
  const verdict = terminalOutput(toolResults, "reportAdvance");
  if (verdict == null) return { kind: "failed" };
  if (verdict.verdict === "no-next") return { kind: "no-next" };
  // Landed — but an unchanged URL means the click went nowhere: treat as
  // no-next so the orchestrator falls to the target stage.
  const sts = SessionTabService.getInstance();
  const url = sts.getTab(ctx.activeTabId)?.webContents.getURL() ?? "";
  if (url === prevUrl) {
    logger.info("advance reported landed but URL unchanged — treating as no-next", {
      threadId: ctx.threadId,
      chapterNumber: n,
    });
    return { kind: "no-next" };
  }
  return { kind: "landed" };
}

// ---------------------------------------------------------------------------
// 4. extractChapterAgent — dump the chapter's complete prose
// ---------------------------------------------------------------------------

/** Verdict of the extract agent. */
type ExtractChapterOutcome =
  | { kind: "saved"; content: string; title: string | null }
  | { kind: "wall"; reason: string }
  | { kind: "failed" };

/**
 * `saveChapterContent` — the extract agent's terminal tool and the ONLY way
 * prose is delivered: it writes the source row directly (context API:
 * threadId + chapterNumber never appear in the prompt).
 */
const saveChapterContentTool = tool({
  description:
    "Call this ONCE with the COMPLETE prose of the current chapter when you have read all of it.",
  inputSchema: z.object({
    content: z
      .string()
      .min(1)
      .describe("The full prose of this chapter, joined in reading order."),
    title: z
      .string()
      .nullable()
      .describe("The chapter's own title if visible, else null."),
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
      { content: input.content, title: input.title },
    );
    logger.info("chapter content saved", {
      threadId: ctx.threadId,
      chapterNumber: ctx.chapterNumber,
      contentLen: input.content.length,
    });
    return { saved: true };
  },
});

/** Result of a successful save (named for tool-type portability). */
interface SavedChapterEcho {
  saved: boolean;
}

/**
 * The browser is ALREADY on chapter `n`'s reading page (landed by a previous
 * agent). The agent reads the page, follows within-chapter 下一页 pagination,
 * skips page chrome AND adjacent-chapter teasers, and saves the complete
 * prose via `saveChapterContent`.
 */
export async function extractChapterAgent(
  ctx: Ctx,
  novel: InternetNovel,
  n: number,
): Promise<ExtractChapterOutcome> {
  const titlePart = novel.title.trim() || "the requested book";
  const instructions = `You are an extraction agent controlling a browser via tools. The browser is ALREADY showing chapter ${n} of "${titlePart}" — do NOT navigate to a different URL to find it.

Your job: extract the COMPLETE prose of this chapter and save it.

Steps:
1. Call getFlattenDOM to read the current page.
2. Extract the chapter's actual prose — the narrative text — skipping ads, navigation, sidebars, comments sections, "please log in" banners, and other page chrome. ALSO skip adjacent-chapter teaser/recommendation blocks: lists of "related chapters", next-chapter previews, and recommendation carousels are NOT part of this chapter.
3. Some sites split ONE chapter across multiple pages with a 下一页 / next-PAGE control. If the SAME chapter continues on a next PAGE, call clickElement on the next-page control, then getFlattenDOM again and continue collecting.
4. NEVER follow links to a DIFFERENT chapter (下一章 / 上一章 / toc entries) — when you see a next-CHAPTER control, the current chapter's text is done.
5. Once you have the COMPLETE prose, call saveChapterContent with the full text joined in reading order and the chapter's title (or null).

${buildUserInteractionWallBlock(
  "do NOT call saveChapterContent and do NOT treat the wall as the chapter's end: saving would commit a truncated chapter. Simply stop — the site is rotated",
)}

Rules:
- Output prose only — no commentary, no markdown headings, no "end of chapter" markers.
- Call saveChapterContent exactly once, with everything.`;

  const toolResults = await runAgent({
    instructions,
    user: `Read chapter ${n} of "${titlePart}" completely (following next-PAGE within the chapter only) and save its prose.`,
    tools: {
      getFlattenDOM: getFlattenDOMTool,
      clickElement: clickElementTool,
      reportWall: reportWallTool,
      saveChapterContent: saveChapterContentTool,
    },
    ctx,
    terminal: "saveChapterContent",
    maxSteps: 20,
    telemetryId: "entertainment-internet-extract",
  });

  const wall = wallReason(toolResults);
  if (wall != null) return { kind: "wall", reason: wall };
  const verdict = terminalOutput(toolResults, "saveChapterContent");
  if (verdict == null || verdict.saved !== true) return { kind: "failed" };
  // The tool wrote content+title to the row; re-read to hand the caller the
  // saved values (it applies the MIN_PROSE_CHARS budget).
  const row = entertainmentFrontendService.getSourceChapter(
    ctx.threadId,
    ctx.chapterNumber,
  );
  const content = row?.content ?? "";
  const title = row?.title ?? null;
  return { kind: "saved", content, title };
}

// ---------------------------------------------------------------------------
// 5. finalityProofAgent — is chapter n-1 the book's last chapter?
// ---------------------------------------------------------------------------

/** Verdict of the finality-proof agent. */
type FinalityOutcome =
  | { kind: "last" }
  | { kind: "not-last" }
  | { kind: "wall"; reason: string }
  | { kind: "failed" };

/**
 * Chapter n-1's page had no next-chapter control. The browser is on
 * `tocUrl` (a toc page) or a chapter page (the agent follows its 目录 link
 * first). The agent checks whether chapter n-1's toc entry is the book's
 * LAST entry — minding ongoing-serialization footers (本书未完 etc.: any
 * later entry ⇒ not-last). This proof is what makes `"finalChapter"` safe.
 */
export async function finalityProofAgent(
  ctx: Ctx,
  novel: InternetNovel,
  n: number,
  prevChapterTitle: string | null,
  url: string,
): Promise<FinalityOutcome> {
  const reportFinality = tool({
    description: "Report whether the previous chapter is the book's last.",
    inputSchema: z.object({
      verdict: z.enum(["last", "not-last"]),
      reason: z
        .string()
        .describe(
          'One sentence: what the toc shows (e.g. "第41章 is the final entry", "entries continue past it").',
        ),
    }),
    execute: async (input) => input,
  });

  const titlePart = novel.title.trim() || "the requested book";
  const entryLabel = prevChapterTitle ?? `chapter ${n - 1}`;
  const instructions = `You are a finality-proof agent controlling a browser via tools. The previous chapter (${entryLabel}) of "${titlePart}" had NO next-chapter control on its page. Before the system declares the book finished, you must PROVE it from the table of contents.

Steps:
1. The browser is on ${url}. If that is a reading page rather than the toc, find the page's 目录 / 章节列表 / table-of-contents link and click it first.
2. Read the toc and locate the entry for "${entryLabel}".
3. Determine whether that entry is the LAST entry of the book:
   - If entries continue AFTER it (later chapters, or an ongoing-serialization footer like 本书未完 / 未完待续 / "updating"), the book is NOT finished → verdict "not-last".
   - If "${entryLabel}" is the final entry and the book is marked complete (完本 / 已完结 / "the end"), verdict "last".
4. Call reportFinality with your verdict and reason.

${buildUserInteractionWallBlock(
  "call reportWall immediately — a wall is never proof of finality; a walled toc must NEVER yield verdict \"last\"",
)}

Remember: VIP / 会员 / lock markers anywhere in the toc are a wall (reportWall), not finality evidence.`;

  const toolResults = await runAgent({
    instructions,
    user: `Prove from the table of contents whether "${entryLabel}" of "${titlePart}" is the book's last chapter.`,
    tools: {
      getFlattenDOM: getFlattenDOMTool,
      clickElement: clickElementTool,
      reportWall: reportWallTool,
      reportFinality,
    },
    ctx,
    terminal: "reportFinality",
    maxSteps: 20,
    telemetryId: "entertainment-internet-finality",
  });

  const wall = wallReason(toolResults);
  if (wall != null) return { kind: "wall", reason: wall };
  const verdict = terminalOutput(toolResults, "reportFinality");
  if (verdict == null) return { kind: "failed" };
  return verdict.verdict === "last" ? { kind: "last" } : { kind: "not-last" };
}

// Keep SavedChapterEcho referenced — it documents the echo contract above.
export type { SavedChapterEcho };
