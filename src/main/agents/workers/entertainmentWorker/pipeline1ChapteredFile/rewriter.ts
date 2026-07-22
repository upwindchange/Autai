/**
 * Pipeline ① — chaptered-file REWRITER (per source row, LLM).
 *
 * This is the REAL co-writer that replaces the placeholder prefix the scheduler
 * used to emit. It owns one `rewritten_chapters` row end to end, mirroring the
 * source row 1:1 by `chapterNumber` (the spine key the reader navigates by).
 * The source row is itself the outliner's merge unit — it may cover several
 * original chapter headings concatenated into one storyline (a tournament arc
 * spanning 3 original chapters becomes ONE source row) — but that is opaque to
 * the rewriter: it rewrites the row's `content` as a single prose unit and
 * writes the result back at the same `chapterNumber`.
 *
 * DELIBERATELY INDEPENDENT of `../rewriter.ts` (pipeline ②'s 1:1 internet
 * rewriter). That file's `outputProcessedContent` tool and 85-tactic 情境脱水
 * prompt builder are tailored to single-chapter internet sources and a fixed
 * `DehydrateConfig["options"]` shape. Pipeline ①'s rewriter will eventually
 * grow its OWN prompt builder for cross-chapter storyline dehydration; for now
 * it ships with a PLACEHOLDER prompt (decision: close the end-to-end loop
 * first, iterate the real prompt later). The structural pattern — terminal
 * output tool, forced toolChoice, one-shot RETRY_SUFFIX, "rewriting" → run →
 * "rewritten"/"error" lifecycle — is modeled on `../rewriter.ts` and on
 * `../pipeline3NonNovel/scheduler.ts`'s inline rewrite.
 *
 * ROW LIFECYCLE (the "no duplicate trigger" lock): `rewriteChapter` flips the
 * row to `"rewriting"` BEFORE the agent runs. The scheduler's `needsWork`
 * treats only `"rewritten"` as complete, so a row stuck in `"rewriting"` (the
 * process was killed mid-agent) is auto-redone on the next `ensureRange` /
 * restart thread-open — the dirty flag cleans itself, no dedicated sweep.
 */

import { streamText, stepCountIs, tool } from "ai";
import { z } from "zod";
import log from "electron-log/main";
import {
  complexModel,
  forwardSamplingParams,
  reasoningProviderOptions,
} from "@agents/providers";
import { hasSuccessfulToolResult, TIMEOUTS } from "@agents/utils";
import { settingsService, entertainmentService } from "@/services";

const logger = log.scope("Dehydrate:Pipeline1:Rewriter");

/** Terminal status the rewrite agent reports back to the scheduler. */
export type RewriteOutcome = "rewritten" | "error";

/**
 * PLACEHOLDER rewrite system prompt. This is intentionally NOT the final
 * cross-chapter-storyline dehydration prompt — it is a minimal stand-in that
 * closes the end-to-end rewrite loop (the scheduler, queue, retry, and
 * self-heal plumbing) so the whole pipeline can be exercised before the real
 * prompt builder lands. It does a conservative clean + tighten of the source
 * prose, preserving plot and language. Swapped out for the real prompt builder
 * in a follow-up (the structure around it — RETRY_SUFFIX, OUTPUT_CONTRACT, the
 * tool, the lifecycle — stays).
 */
const REWRITE_SYSTEM_PROMPT = [
  "你是一名小说脱水编辑。给定一章（可能由原著多个连续章节合并而成的一个剧情单元）的原文，请脱水重写它，使其更紧凑可读：",
  "- 删除明显的套话、水字数、重复的描写与无意义的反应；",
  "- 理顺断裂的句子与段落，统一语气和格式；",
  "- 精简拖沓的剧情循环，但保留所有情节走向、关键事件与人物决策；",
  "- 保留原文的语言（除非另有翻译要求）；",
  "- 不要添加、编造或删除实质内容与情节。",
].join("\n");

/**
 * Reinforcement appended on the one-shot retry when the agent stopped without
 * calling `outputCoWrittenContent` (it streamed prose as plain text). Tells
 * the model the plain-text output was discarded and it must hand the prose
 * back through the tool. Modeled on `../rewriter.ts`'s `RETRY_SUFFIX`.
 */
const RETRY_SUFFIX = `

## ⚠ 你的上一次提交无效——必须通过工具重新提交
你的上一次回复没有调用 outputCoWrittenContent 工具，而是直接输出了纯文本。纯文本不被接受，因此结果无效。请现在重新提交：调用 outputCoWrittenContent 工具，把重写后的完整正文放进 content 参数。不要输出纯文本，也不要在工具调用之外写任何正文。`;

/**
 * Output contract appended to the system prompt: the only valid terminal step
 * is calling `outputCoWrittenContent` with the rewritten prose. Plain-text
 * output is rejected.
 */
const OUTPUT_CONTRACT = [
  "The only thing you are allowed to do is to call the outputCoWrittenContent tool:",
  "- Place the full rewritten content in the tool's `content` parameter;",
  "- You are not allowed to output the content anywhere else other than the outputCoWrittenContent tool;",
  "- You are not allowed to output anything other than calling the outputCoWrittenContent tool;",
  "- `content` must contain only the prose itself: no explanations, asides, or preambles/postscripts;",
  "- Do not use Markdown or code blocks; preserve sensible paragraph breaks;",
  "- Keep the output language the same as the source;",
  "- Emitting plain text without calling the outputCoWrittenContent tool will result in fatal failure.",
].join("\n");

/**
 * `outputCoWrittenContent` — the pipeline ① rewrite agent's terminal tool and
 * the ONLY way it delivers the result. The agent calls it once with the fully
 * rewritten prose; execute writes that prose + the `"rewritten"` status to
 * `rewritten_chapters(N)` in one shot, and `hasSuccessfulToolResult` then
 * stops the stream — so this single tool call both persists the result and
 * terminates the agent. `threadId` / `chapterNumber` arrive via
 * `experimental_context` (zero-token — never in the prompt). Named as an
 * output verb so the model reads it as "this is how I hand back the rewritten
 * text", not a side-effect save it might skip in favor of plain-text output.
 *
 * Distinct from `../rewriter.ts`'s `outputProcessedContent` (pipeline ②) and
 * `../pipeline3NonNovel/scheduler.ts`'s `outputContent` (pipeline ③) on
 * purpose: each pipeline owns its output tool so its write path (key, prompt,
 * telemetry functionId) can diverge without cross-pipeline coupling.
 */
const outputCoWrittenContentTool = tool({
  description:
    "The ONLY way to end your output and deliver the rewritten content — " +
    "call this outputCoWrittenContent tool with the full rewritten prose as `content`. " +
    "You are NOT ALLOWED to output the prose as plain text and stop your output; " +
    "it must go through this outputCoWrittenContent tool.",
  inputSchema: z.object({
    content: z
      .string()
      .min(1)
      .describe("The full rewritten chapter content, content only."),
  }),
  execute: async (input, { experimental_context }) => {
    const ctx = experimental_context as {
      threadId: string;
      chapterNumber: number;
    };
    entertainmentService.updateRewrittenChapter(
      ctx.threadId,
      ctx.chapterNumber,
      {
        content: input.content,
        status: "rewritten",
      },
    );
    logger.info("co-written content output", {
      threadId: ctx.threadId,
      chapterNumber: ctx.chapterNumber,
      contentLen: input.content.length,
    });
    return { saved: true };
  },
});

/**
 * Run one rewrite-agent pass under `systemPrompt`. Returns whether the agent
 * called `outputCoWrittenContent` (the tool's execute already wrote the result
 * to the DB on success). Forced `toolChoice` + `hasSuccessfulToolResult` make
 * the tool call the agent's terminal step; some models still ignore the forced
 * tool and stop on plain text — that's recovered by the caller's one-shot
 * retry with `RETRY_SUFFIX`, not by this helper.
 */
async function runRewriteAgent(
  systemPrompt: string,
  sourceText: string,
  threadId: string,
  chapterNumber: number,
  signal?: AbortSignal,
): Promise<boolean> {
  const resolved = complexModel();
  const sampling = forwardSamplingParams(resolved.params);
  const reasoning = reasoningProviderOptions(
    resolved.params,
    resolved.model,
    resolved.npm,
  );
  const result = streamText({
    model: resolved.model,
    system: systemPrompt,
    messages: [{ role: "user", content: sourceText }],
    tools: {
      outputCoWrittenContent: outputCoWrittenContentTool,
    },
    toolChoice: { type: "tool", toolName: "outputCoWrittenContent" },
    stopWhen: [
      hasSuccessfulToolResult("outputCoWrittenContent"),
      stepCountIs(3),
    ],
    maxRetries: settingsService.settings.maxRetries,
    timeout: TIMEOUTS.chat,
    abortSignal: signal,
    ...sampling,
    ...(reasoning && { providerOptions: reasoning }),
    experimental_context: { threadId, chapterNumber },
    experimental_telemetry: {
      isEnabled: settingsService.settings.langfuse.enabled,
      functionId: "entertainment-pipeline1-rewrite",
      metadata: { threadId, chapterNumber },
    },
  });
  const steps = await result.steps;
  return steps
    .flatMap((s) => s.toolResults ?? [])
    .some(
      (tr) =>
        tr.toolName === "outputCoWrittenContent" && tr.type === "tool-result",
    );
}

/**
 * Rewrite one source row's 原文 → 重写 via a single-shot agent. Owns its own
 * `rewritten_chapters` row lifecycle end to end (the "no duplicate trigger"
 * lock): marks `"rewriting"` up front so concurrent `ensureRange` calls see it
 * as in-progress and skip it (`needsWork` treats only `"rewritten"` as done),
 * then runs the agent under the placeholder prompt + output contract (whose
 * output contract requires delivering the prose via `outputCoWrittenContent`,
 * never as plain text), and the tool dumps the rewritten prose + the
 * `"rewritten"` status to the DB. If the agent ignores the forced tool and
 * stops on plain text, one retry runs with a reinforced prompt (`RETRY_SUFFIX`)
 * explaining the failure. On a second failure or a hard error the row is
 * marked `"error"` — `needsWork` then treats `"error"` as NOT terminal and
 * auto-redoes it on the next `ensureRange` (per the pipeline's no-error-
 * terminal policy; only `"rewritten"` is complete). Returns the terminal
 * status so the scheduler can branch without touching the DB itself.
 *
 * The source text is re-read here (not passed in): the outliner may have just
 * committed/merged the row, and the scheduler's in-memory copy would be stale.
 */
export async function rewriteChapter(
  threadId: string,
  chapterNumber: number,
  signal?: AbortSignal,
): Promise<RewriteOutcome> {
  // Own the rewrite-row lifecycle: mark in-progress (insert fresh or reset
  // stale). This is the "rewriting" lock that makes the row invisible to a
  // concurrent needsWork check.
  const source = entertainmentService.getSourceChapter(threadId, chapterNumber);
  const existing = entertainmentService.getRewrittenChapter(
    threadId,
    chapterNumber,
  );
  if (!existing) {
    entertainmentService.insertRewrittenChapter({
      threadId,
      chapterNumber,
      sourceChapterId: source?.id,
      status: "rewriting",
    });
  } else {
    entertainmentService.updateRewrittenChapter(threadId, chapterNumber, {
      status: "rewriting",
    });
  }

  const sourceText = source?.content ?? "";

  logger.info("rewriting", {
    threadId,
    chapterNumber,
    sourceLen: sourceText.length,
  });

  const basePrompt = `${REWRITE_SYSTEM_PROMPT}\n\n${OUTPUT_CONTRACT}`;
  try {
    let saved = await runRewriteAgent(
      basePrompt,
      sourceText,
      threadId,
      chapterNumber,
      signal,
    );
    if (!saved) {
      // The agent stopped without calling the tool (typical: it streamed prose
      // as plain text). Reinforce the ending condition and retry once.
      logger.warn(
        "rewrite stopped without outputCoWrittenContent; retrying once",
        { threadId, chapterNumber },
      );
      saved = await runRewriteAgent(
        `${basePrompt}${RETRY_SUFFIX}`,
        sourceText,
        threadId,
        chapterNumber,
        signal,
      );
    }
    if (saved) {
      entertainmentService.touchThread(threadId);
      logger.info("chapter rewritten", { threadId, chapterNumber });
      return "rewritten";
    }
    logger.error("rewrite ended without calling outputCoWrittenContent", {
      threadId,
      chapterNumber,
    });
    entertainmentService.updateRewrittenChapter(threadId, chapterNumber, {
      status: "error",
    });
    return "error";
  } catch (err) {
    logger.error("rewrite failed", { threadId, chapterNumber, err });
    entertainmentService.updateRewrittenChapter(threadId, chapterNumber, {
      status: "error",
    });
    return "error";
  }
}
