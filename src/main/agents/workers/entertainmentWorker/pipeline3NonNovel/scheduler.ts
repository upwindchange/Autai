/**
 * Pipeline ③ — non-novel scheduler.
 *
 * Serves NON-NOVEL sources: both file uploads AND single-piece internet sources
 * (a long post, an email thread, an article). It forks at the ACQUISITION stage:
 *  - file → decode the whole file into 1 source row (chapterNumber 1)
 *  - internet → single-page fetch into 1 source row (chapterNumber 1)
 * Then runs a LIGHTWEIGHT one-pass rewrite (clean non-prose artifacts + smooth),
 * producing exactly ONE rewrite output (chapterNumber 1).
 *
 * This is a complete, INDEPENDENT scheduling core implementing the
 * `PipelineScheduler` contract (6 methods). It is much simpler than pipelines
 * ①/② because the "output spine" is a single number (1): there is no lookahead
 * window, no per-output serial queue, and no in-flight dedup set — every entry
 * point just (re)runs the single acquire→rewrite pass, guarded by an
 * `outlineRunning` mutex and an `isComplete` check.
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
import {
  settingsService,
  entertainmentService,
  threadPersistenceService,
} from "@/services";
import type { DehydrateConfig } from "@shared";
import { fetchSinglePage } from "../shared/fetchSinglePage";
import type {
  PipelineScheduler,
  WorkerLiveness,
} from "../shared/pipelineScheduler";

const logger = log.scope("Dehydrate:Pipeline3:NonNovel");

/**
 * Lightweight, NON-web-novel system prompt for the single rewrite pass. This is
 * deliberately NOT the 85-tactic 情境脱水 prompt (those are web-novel-specific
 * and irrelevant to a post/article). It only cleans non-prose artifacts and
 * smooths the text, preserving every fact and opinion. An output contract is
 * appended demanding the result be delivered via the `outputContent` tool.
 */
const REWRITE_SYSTEM_PROMPT = [
  "你是一名文本整理编辑。给定一段非虚构/非小说的连续文本（如长帖、邮件往来、论坛串、文章），请清理并理顺它，使其成为流畅可读的内容：",
  "- 删除签名、时间戳、引用块、邮件头、论坛楼层与引用等非正文痕迹；",
  "- 统一语气和格式，理顺断裂的句子与段落；",
  "- 合并重复内容，但保留所有事实信息与观点；",
  "- 保留原文的语言（除非另有翻译要求）；",
  "- 不要添加、编造或删除实质内容。",
].join("\n");

/**
 * Reinforcement appended on the one-shot retry when the agent stopped without
 * calling `outputContent` (it streamed prose as plain text). Tells the model the
 * plain-text output was discarded and it must hand the prose back through the
 * tool. Modeled on rewriter.ts's `RETRY_SUFFIX`.
 */
const RETRY_SUFFIX = `

## ⚠ 你的上一次提交无效——必须通过工具重新提交
你的上一次回复没有调用 outputContent 工具，而是直接输出了纯文本。纯文本不被接受，因此结果无效。请现在重新提交：调用 outputContent 工具，把整理好的完整正文放进 content 参数。不要输出纯文本，也不要在工具调用之外写任何正文。`;

/**
 * Output contract appended to the system prompt: the only valid terminal step is
 * calling `outputContent` with the cleaned prose. Plain-text output is rejected.
 */
const OUTPUT_CONTRACT = [
  "The only thing you are allowed to do is to call the outputContent tool:",
  "- Place the full cleaned content in the tool's `content` parameter;",
  "- You are not allowed to output the content anywhere else other than the outputContent tool;",
  "- You are not allowed to output anything other than calling the outputContent tool;",
  "- `content` must contain only the prose itself: no explanations, asides, or preambles/postscripts;",
  "- Do not use Markdown headings or code blocks; preserve sensible paragraph breaks;",
  "- Keep the output language the same as the source;",
  "- Emitting plain text without calling the outputContent tool will result in fatal failure.",
].join("\n");

/**
 * `outputContent` — the non-novel rewrite agent's terminal tool and the ONLY way
 * it delivers the result. Modeled on rewriter.ts's `outputProcessedContentTool`
 * but DEFINED INLINE here (rewriter.ts's tool writes by `chapterNumber` via its
 * own context; this one is pinned to `chapterNumber = 1`, the single output
 * pipeline ③ produces). `threadId` arrives via `experimental_context`
 * (zero-token). On success the tool writes the cleaned prose + `"rewritten"`
 * status to `rewritten_chapters(1)` in one shot, and `hasSuccessfulToolResult`
 * then stops the stream.
 */
const outputContentTool = tool({
  description:
    "The ONLY way to end your output and deliver the cleaned content — " +
    "call this outputContent tool with the full cleaned prose as `content`. " +
    "You are NOT ALLOWED to output the prose as plain text and stop your output; " +
    "it must go through this outputContent tool.",
  inputSchema: z.object({
    content: z
      .string()
      .min(1)
      .describe("The full cleaned content, content only."),
  }),
  execute: async (input, { experimental_context }) => {
    const ctx = experimental_context as { threadId: string };
    entertainmentService.updateRewrittenChapter(ctx.threadId, 1, {
      content: input.content,
      status: "rewritten",
    });
    logger.info("processed content output", {
      threadId: ctx.threadId,
      contentLen: input.content.length,
    });
    return { saved: true };
  },
});

/**
 * Run one lightweight rewrite-agent pass under `systemPrompt`. Returns whether
 * the agent called `outputContent` (the tool's execute already wrote the result
 * to the DB on success). Forced `toolChoice` + `hasSuccessfulToolResult` make
 * the tool call the agent's terminal step; some models ignore the forced tool
 * and stop on plain text — that's recovered by the caller's one-shot retry with
 * `RETRY_SUFFIX`.
 */
async function runRewriteAgent(
  systemPrompt: string,
  sourceText: string,
  threadId: string,
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
      outputContent: outputContentTool,
    },
    toolChoice: { type: "tool", toolName: "outputContent" },
    stopWhen: [hasSuccessfulToolResult("outputContent"), stepCountIs(3)],
    maxRetries: settingsService.settings.maxRetries,
    timeout: TIMEOUTS.novel,
    ...(signal && { abortSignal: signal }),
    ...sampling,
    ...(reasoning && { providerOptions: reasoning }),
    experimental_context: { threadId },
    experimental_telemetry: {
      isEnabled: settingsService.settings.langfuse.enabled,
      functionId: "entertainment-pipeline3-rewrite",
      metadata: { threadId },
    },
  });
  const steps = await result.steps;
  return steps
    .flatMap((s) => s.toolResults ?? [])
    .some((tr) => tr.toolName === "outputContent" && tr.type === "tool-result");
}

/**
 * Lightweight one-pass rewrite for a non-novel source. Owns the rewrite-row
 * lifecycle for `chapterNumber = 1` end to end: marks `"rewriting"` up front,
 * reads the source prose, runs the agent under the non-web-novel prompt (clean
 * non-prose artifacts + smooth), and the `outputContent` tool dumps the cleaned
 * prose + `"rewritten"` status to the DB. If the agent ignores the forced tool
 * and stops on plain text, one retry runs with a reinforced prompt. On a second
 * failure or a hard error the row is marked `"error"`. Returns the terminal
 * status so the caller can branch.
 */
async function rewriteNonNovel(
  threadId: string,
  _options: DehydrateConfig["options"],
  signal?: AbortSignal,
): Promise<"rewritten" | "error"> {
  // Own the rewrite-row lifecycle: mark in-progress (insert fresh or reset stale).
  const source = entertainmentService.getSourceChapter(threadId, 1);
  const existing = entertainmentService.getRewrittenChapter(threadId, 1);
  if (!existing) {
    entertainmentService.insertRewrittenChapter({
      threadId,
      chapterNumber: 1,
      status: "rewriting",
    });
  } else {
    entertainmentService.updateRewrittenChapter(threadId, 1, {
      status: "rewriting",
    });
  }

  const sourceText = source?.content ?? "";

  logger.info("rewriting non-novel", {
    threadId,
    sourceLen: sourceText.length,
  });

  const basePrompt = `${REWRITE_SYSTEM_PROMPT}\n\n${OUTPUT_CONTRACT}`;
  try {
    let saved = await runRewriteAgent(basePrompt, sourceText, threadId, signal);
    if (!saved) {
      // The agent stopped without calling the tool (typical: plain-text output).
      // Reinforce the ending condition and retry once.
      logger.warn("rewrite stopped without outputContent; retrying once", {
        threadId,
      });
      saved = await runRewriteAgent(
        `${basePrompt}${RETRY_SUFFIX}`,
        sourceText,
        threadId,
        signal,
      );
    }
    if (saved) {
      entertainmentService.touchThread(threadId);
      logger.info("non-novel rewritten", { threadId });
      return "rewritten";
    }
    logger.error("rewrite ended without calling outputContent", { threadId });
    entertainmentService.updateRewrittenChapter(threadId, 1, {
      status: "error",
    });
    return "error";
  } catch (err) {
    logger.error("rewrite failed", { threadId, err });
    entertainmentService.updateRewrittenChapter(threadId, 1, {
      status: "error",
    });
    return "error";
  }
}

/**
 * Per-thread worker state for pipeline ③. Much smaller than pipelines ①/②:
 * there is no serial p-queue (no lookahead window — exactly one output) and no
 * `inFlight` dedup set. `outlineRunning` is the mutex that serializes the single
 * acquire→rewrite pass against re-entry (upload + resume + poll + retry).
 */
interface ThreadWorker {
  /** True while a buildOutlines run is in progress — re-entrancy mutex. */
  outlineRunning: boolean;
  /** Latest requested output number (always 1 here; backs GET /worker). */
  target: number;
  /** Abort controller for a running rewrite pass, so `stop` can preempt it.
   * Undefined when nothing is running. */
  abortController?: AbortController;
}

/**
 * Pipeline ③ scheduler for non-novel sources. Implements `PipelineScheduler`.
 * The "output spine" is a single number (1), so the contract's lookahead/range
 * machinery collapses to "make sure the one pass has run": every entry point
 * fires (or re-runs) the same `buildOutlines`, guarded by `outlineRunning` +
 * `isComplete`.
 */
class NonNovelScheduler implements PipelineScheduler {
  private workers = new Map<string, ThreadWorker>();

  private workerFor(threadId: string): ThreadWorker {
    let w = this.workers.get(threadId);
    if (!w) {
      w = { outlineRunning: false, target: 1 };
      this.workers.set(threadId, w);
    }
    return w;
  }

  /**
   * Completion check: the single rewrite output (chapterNumber 1) exists and is
   * `"rewritten"`. `buildOutlines` and the fire-and-forget entry points all gate
   * on this so a completed thread is never re-processed.
   */
  private isComplete(threadId: string): boolean {
    return (
      entertainmentService.getRewrittenChapter(threadId, 1)?.status ===
      "rewritten"
    );
  }

  /**
   * The fork + rewrite driver for pipeline ③. Acquires the source (forking by
   * novel.type: file → decode whole file into 1 source row; internet →
   * single-page fetch into 1 source row), then runs the lightweight one-pass
   * rewrite, producing the single rewrite output (chapterNumber 1). Idempotent +
   * re-entrancy-guarded: bails early on a wrong-pipeline config, on a completed
   * thread, or on a concurrent run.
   */
  async buildOutlines(threadId: string): Promise<void> {
    const config = entertainmentService.getParsedConfig(threadId);
    // Only this pipeline owns non-novel dehydrate threads.
    if (
      !config ||
      config.mode !== "dehydrate" ||
      !config.options.nonNovelSource
    ) {
      return; // wrong pipeline
    }
    // Already done — don't reprocess a completed thread.
    if (this.isComplete(threadId)) {
      logger.info("buildOutlines skipped — already complete", { threadId });
      return;
    }
    // Persisted stop gate: a thread the user stopped stays stopped. This is the
    // single chokepoint — `ensureRange` (reader poll) and `retryFailed` both
    // funnel through `buildOutlines`, so gating here covers every reader-driven
    // resurrection path. Cleared only by an explicit user "go" (Process/Redo/
    // wizard Start), which runs before this is reached.
    if (entertainmentService.getStopStatus(threadId) === "stopped") {
      logger.info("buildOutlines skipped — thread stopped", { threadId });
      return;
    }
    const w = this.workerFor(threadId);
    if (w.outlineRunning) {
      logger.info("buildOutlines skipped — run already in progress", {
        threadId,
      });
      return;
    }
    w.outlineRunning = true;
    // Fresh abort controller for this pass so `stop` can preempt the rewrite.
    const abortController = new AbortController();
    w.abortController = abortController;
    try {
      // 1) Acquire source (fork by novel.type).
      const source = entertainmentService.getSourceChapter(threadId, 1);
      if (!source || source.status !== "fetched") {
        if (config.novel.type === "file") {
          // Decode the whole file into 1 source row. The upload route already
          // decoded + setRawNovelText; read it and persist as the single source
          // row (status "fetched"). finalChapterNumber is unknown until this
          // lands.
          const raw = entertainmentService.getRawNovelText(threadId);
          if (!raw) {
            logger.info("buildOutlines: no raw text yet — nothing to do", {
              threadId,
            });
            return; // upload hasn't run / already consumed
          }
          const existing = entertainmentService.getSourceChapter(threadId, 1);
          if (!existing) {
            entertainmentService.insertSourceChapter({
              threadId,
              chapterNumber: 1,
              content: raw,
              title: config.novel.filename,
              status: "fetched",
            });
          } else {
            entertainmentService.updateSourceChapter(threadId, 1, {
              content: raw,
              title: config.novel.filename,
              status: "fetched",
            });
          }
          // The blob is dead weight now that the whole file is in the source row.
          entertainmentService.clearRawNovelText(threadId);
        } else {
          // Internet non-novel: single-page fetch into 1 source row. config.novel
          // is InternetNovel in this branch.
          const outcome = await fetchSinglePage(config.novel, threadId);
          if (outcome !== "fetched") {
            logger.warn("buildOutlines: single-page fetch failed", {
              threadId,
            });
            return; // fetcher already marked the source row "error"
          }
        }
      }

      // 2) Lightweight one-pass rewrite → single output (chapterNumber 1).
      await rewriteNonNovel(threadId, config.options, abortController.signal);

      // 3) Single output — its finalChapterNumber is 1.
      if (entertainmentService.getFinalChapterNumber(threadId) == null) {
        entertainmentService.setFinalChapterNumber(threadId, 1);
      }
    } finally {
      w.outlineRunning = false;
      if (w.abortController === abortController) {
        w.abortController = undefined;
      }
    }
  }

  /**
   * Ensure every output in [from, to] is processed. For this pipeline there is
   * only ever output 1, so this just (re)runs the single acquire→rewrite pass if
   * not yet complete — fire-and-forget, serialized by the `outlineRunning`
   * mutex. `to` is irrelevant (single output).
   */
  ensureRange(threadId: string, from: number, _to: number): void {
    const w = this.workerFor(threadId);
    w.target = from;
    if (this.isComplete(threadId)) return;
    void this.buildOutlines(threadId).catch((err) =>
      logger.error("ensureRange buildOutlines failed", { threadId, err }),
    );
  }

  /**
   * No-op for ③. The single-page acquire is bundled into `buildOutlines` (one
   * acquire → one rewrite pass), so there is no separate fetch phase to run
   * ahead of rewrite. The interface requires it; only ② implements a real
   * prefetch.
   */
  prefetchRange(_threadId: string, _from: number, _to: number): void {
    // intentional no-op
  }

  /**
   * Re-run if the single source or rewrite row is `"error"`. The re-run's own
   * sub-steps reset the errored row (the fetcher resets source → "fetching"; the
   * rewriter resets rewrite → "rewriting"), so this just fire-and-forgets
   * `buildOutlines`. Returns 1 if an error was found (and re-enqueued), else 0.
   */
  retryFailed(threadId: string): number {
    const source = entertainmentService.getSourceChapter(threadId, 1);
    const rewrite = entertainmentService.getRewrittenChapter(threadId, 1);
    const hadError = source?.status === "error" || rewrite?.status === "error";
    if (!hadError) return 0;
    logger.info("retry failed non-novel", { threadId });
    void this.buildOutlines(threadId).catch((err) =>
      logger.error("retryFailed buildOutlines failed", { threadId, err }),
    );
    return 1;
  }

  /** Liveness + target — backs GET /worker. */
  getInfo(threadId: string): WorkerLiveness {
    const w = this.workers.get(threadId);
    if (!w) return { active: false, target: 0, pending: 0, size: 0 };
    return {
      active: w.outlineRunning,
      target: w.target,
      pending: 0, // no per-output queue
      size: 0,
    };
  }

  /**
   * Snapshot of outputs currently scheduled. Always empty for pipeline ③: there
   * is no per-output serial queue or dedup set (one output, mutex-guarded).
   * Read-only (does NOT create a worker).
   */
  getInFlight(_threadId: string): Set<number> {
    return new Set<number>();
  }

  /**
   * Stop the in-flight rewrite pass — the IMMEDIATE layer: abort its
   * AbortController. No-op for a thread with no worker. There is no queue to
   * drain (pipeline ③ has a single mutex-guarded pass). The DURABLE layer
   * (`stopStatus = "stopped"`) is set by the `/stop` route, which gates
   * `buildOutlines` so the reader poll can't re-run the pass. The row left
   * mid-run self-heals only when the flag is cleared (by Process/Redo); no data
   * is deleted or marked terminal.
   */
  stop(threadId: string): void {
    const w = this.workers.get(threadId);
    if (!w) return;
    w.abortController?.abort();
    w.abortController = undefined;
    logger.info("stopped in-flight work", { threadId });
  }

  /**
   * Startup recovery: resume interrupted non-novel work for the threads this
   * pipeline owns. Scans entertainment threads, filters to
   * `mode === "dehydrate" && options.nonNovelSource === true`, and for each
   * whose rewrite output (chapterNumber 1) is missing or not `"rewritten"`,
   * fire-and-forgets `buildOutlines`. Safe on a fresh install (no threads).
   */
  resumeAll(): void {
    const allThreads =
      threadPersistenceService.listThreadsByMode("entertainment");
    let resumed = 0;
    let skipped = 0;
    for (const t of allThreads) {
      const threadId = t.id;
      const config = entertainmentService.getParsedConfig(threadId);
      if (
        !config ||
        config.mode !== "dehydrate" ||
        !config.options.nonNovelSource
      ) {
        skipped++;
        continue; // not ours
      }
      // Resume only if the single output is missing or not yet rewritten.
      const rewrite = entertainmentService.getRewrittenChapter(threadId, 1);
      if (rewrite?.status === "rewritten") {
        skipped++;
        continue;
      }
      // A user-stopped thread stays parked — no auto-resume on boot.
      if (entertainmentService.getStopStatus(threadId) === "stopped") {
        skipped++;
        continue;
      }
      resumed++;
      logger.info("resuming non-novel work on startup", {
        threadId,
        title: t.title,
        rewriteStatus: rewrite?.status ?? null,
      });
      void this.buildOutlines(threadId).catch((err) =>
        logger.error("startup non-novel resume failed", { threadId, err }),
      );
    }
    logger.info("non-novel startup recovery scan complete", {
      totalThreads: allThreads.length,
      resumed,
      skipped,
    });
  }
}

/**
 * The pipeline ③ scheduler singleton. Wired into the pipeline router, which
 * inspects a thread's config and delegates here for non-novel dehydrate threads.
 */
export const nonNovelScheduler: PipelineScheduler = new NonNovelScheduler();
