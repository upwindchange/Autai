import { streamText, isStepCount, tool } from "ai";
import { z } from "zod";
import log from "electron-log/main";
import { complexModel } from "@agents/providers";
import { hasSuccessfulToolResult, TIMEOUTS } from "@agents/utils";
import { settingsService, entertainmentBackendService } from "@/services";
import { getFlattenDOMTool } from "@agents/tools/DOMTools";
import { clickElementTool } from "@agents/tools/InteractiveTools";
import type { InternetNovel } from "@shared";
import type { InternetFetchContext } from "./index";
import { buildUserInteractionWallBlock } from "../../shared/crawlWallPrompt";

const logger = log.scope("Dehydrate:InternetFetch:Phase2");

/**
 * `saveChapterContent` — phase 2's terminal. The agent calls it once it has
 * collected the chapter's full prose (across however many next-PAGE clicks).
 * Writes `content` + `title` to `source_chapters(N)`. No finality decision
 * here — that is phase 1's call (advance abort confirmed by the TOC
 * fallback). `threadId` / `chapterNumber` arrive via context, never via the
 * prompt.
 */
const saveChapterContentTool = tool({
  description:
    "Call this with the FULL prose of the current chapter once you have read every page of it.",
  inputSchema: z.object({
    content: z
      .string()
      .min(1)
      .describe("The full prose of this chapter, joined in reading order."),
    title: z
      .string()
      .nullable()
      .describe("The chapter title if visible on the page, else null."),
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
      chapterNumber: ctx.chapterNumber,
      contentLen: input.content.length,
    });
    return { saved: true };
  },
});

function buildExtractSystemPrompt(
  novel: InternetNovel,
  chapterNumber: number,
): string {
  const titlePart = novel.title.trim() || "the novel";
  const label = `chapter ${chapterNumber}`;
  return `You are an extraction agent controlling a browser via tools. The browser is already showing the BEGINNING of ${label} of "${titlePart}" — phase 1 opened it for you. Do NOT navigate to a different URL, and do NOT decide whether the book has ended.

Your job: collect the COMPLETE prose of ${label} and save it.

Steps:
1. Call getFlattenDOM to read the current page.
2. Extract ${label}'s actual prose — the story / narrative text — skipping ads, navigation, sidebars, comments, "please log in" banners, and other page chrome.
3. Some sites split ONE chapter across multiple pages with a "next page" / "下一页" control. If the SAME ${label} continues on a next PAGE, call clickElement on the next-page control, then call getFlattenDOM again and continue collecting.
4. Stop paginating when you reach the end of ${label} (a "next CHAPTER" link, or the end of the post). Do NOT follow a next-CHAPTER link — that belongs to the next chapter.
5. Once you have the COMPLETE ${label} prose, call saveChapterContent with the full text joined in reading order and the chapter title (or null).

${buildUserInteractionWallBlock(
  "do NOT call saveChapterContent and do NOT treat the wall as the chapter's end: saving would commit a truncated chapter. Simply stop — the chapter is marked failed and retried on a different site",
)}

Rules:
- Output prose only — no commentary, no markdown headings, no "end of chapter" markers.
- Call saveChapterContent exactly once, with everything.`;
}

/**
 * Phase 2 — extract the chapter prose. The crawl tab is already on the
 * chapter's beginning (phase 1 guaranteed it), so this does NO url work and NO
 * navigation to a chapter URL. One agent loop reads the page (getFlattenDOM),
 * clicks next-PAGE while the same chapter continues (clickElement), and dumps
 * the full prose via `saveChapterContent`. Step exhaustion without a save →
 * generic error (no partial content is written).
 */
export async function extractChapter(
  novel: InternetNovel,
  ctx: InternetFetchContext,
): Promise<void> {
  const label = `chapter ${ctx.chapterNumber}`;
  const result = streamText({
    model: complexModel().model,
    instructions: buildExtractSystemPrompt(novel, ctx.chapterNumber),
    messages: [
      { role: "user", content: `Read ${label} and save its full prose.` },
    ],
    tools: {
      getFlattenDOM: getFlattenDOMTool,
      clickElement: clickElementTool,
      saveChapterContent: saveChapterContentTool,
    },
    stopWhen: [hasSuccessfulToolResult("saveChapterContent"), isStepCount(20)],
    maxRetries: settingsService.settings.maxRetries,
    timeout: TIMEOUTS.actionExecution,
    abortSignal: ctx.abortSignal,
    toolsContext: {
      getFlattenDOM: ctx,
      clickElement: ctx,
      saveChapterContent: ctx,
    },
    telemetry: {
      isEnabled: settingsService.settings.langfuse.enabled,
      functionId: "entertainment-internet-extract",
    },
  });

  const steps = await result.steps;
  const saved = steps
    .flatMap((s) => s.toolResults ?? [])
    .some(
      (tr) => tr.toolName === "saveChapterContent" && tr.type === "tool-result",
    );
  if (saved) return; // content + title already written by the tool
  throw new Error(
    `Phase 2 did not save content for chapter ${ctx.chapterNumber}`,
  );
}
