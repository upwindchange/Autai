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
import type { DehydrateConfig } from "@shared";
import { buildDehydrateSystemPrompt } from "../shared/dehydratePrompt";

const logger = log.scope("Dehydrate:Rewriter");

/** Terminal status the rewrite agent reports back to the scheduler. */
export type RewriteOutcome = "rewritten" | "error";

/**
 * `outputProcessedContent` — the rewrite agent's terminal tool and the ONLY way
 * it delivers the result. The agent calls it once with the fully rewritten
 * chapter prose; execute writes that prose + the `"rewritten"` status to
 * `rewritten_chapters(N)` in one shot, and `hasSuccessfulToolResult` then stops
 * the stream — so this single tool call both persists the result and terminates
 * the agent. `threadId` / `chapterNumber` arrive via `experimental_context`
 * (zero-token — never in the prompt). Named as an output verb so the model
 * reads it as "this is how I hand back the rewritten text", not a side-effect
 * save it might skip in favor of plain-text output.
 */
const outputProcessedContentTool = tool({
  description:
    "The ONLY way to end your output and deliver the rewritten content — " +
    "call this outputProcessedContent tool with the full rewritten prose as `content`. " +
    "You are NOT ALLOWED output the prose as plain text and stop your output; " +
    "it must go through this outputProcessedContent tool.",
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
    logger.info("processed content output", {
      threadId: ctx.threadId,
      chapterNumber: ctx.chapterNumber,
      contentLen: input.content.length,
    });
    return { saved: true };
  },
});

/**
 * Reinforcement appended to the system prompt on the one-shot retry when the
 * agent stopped without calling `outputProcessedContent`. Tells the model
 * plainly why its first attempt was rejected (plain-text output is discarded)
 * and that it must hand the prose back through the tool.
 */
const RETRY_SUFFIX = `

## ⚠ Your previous submission was invalid — you must resubmit through the tool
Your last response did not call the outputProcessedContent tool; \
instead, you stopped after emitting plain text. \
Plain text is not accepted, so the result is invalid. \
Please resubmit now: call the outputProcessedContent tool \
and place the full rewritten prose in the content parameter. \
Do not output plain text, \
and do not write any prose outside of the tool call.`;

/**
 * Run one rewrite-agent pass under `systemPrompt`. Returns whether the agent
 * called `outputProcessedContent` (the tool's execute already wrote the result
 * to the DB on success). Forced `toolChoice` + `hasSuccessfulToolResult` make
 * the tool call the agent's terminal step; some models still ignore the forced
 * tool and stop on plain text — that's recovered by the caller's one-shot retry
 * with `RETRY_SUFFIX`, not by this helper.
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
      outputProcessedContent: outputProcessedContentTool,
    },
    toolChoice: { type: "tool", toolName: "outputProcessedContent" },
    stopWhen: [
      hasSuccessfulToolResult("outputProcessedContent"),
      stepCountIs(3),
    ],
    maxRetries: settingsService.settings.maxRetries,
    timeout: TIMEOUTS.novel,
    abortSignal: signal,
    ...sampling,
    ...(reasoning && { providerOptions: reasoning }),
    experimental_context: { threadId, chapterNumber },
    experimental_telemetry: {
      isEnabled: settingsService.settings.langfuse.enabled,
      functionId: "entertainment-rewriter",
      metadata: { threadId, chapterNumber },
    },
  });
  const steps = await result.steps;
  return steps
    .flatMap((s) => s.toolResults ?? [])
    .some(
      (tr) =>
        tr.toolName === "outputProcessedContent" && tr.type === "tool-result",
    );
}

/**
 * Rewrite one chapter's 原文 → 重写 via a single-shot agent. Owns its own
 * `rewritten_chapters` row lifecycle end to end: marks `"rewriting"` up front,
 * runs the agent under the constructed system prompt (whose output contract
 * requires delivering the prose via `outputProcessedContent`, never as plain
 * text), and the tool dumps the rewritten prose + the `"rewritten"` status to
 * the DB. If the agent ignores the forced tool and stops on plain text, one
 * retry runs with a reinforced prompt (`RETRY_SUFFIX`) explaining the failure.
 * On a second failure or a hard error the row is marked `"error"`. Returns the
 * terminal status so the scheduler can branch without touching the DB itself.
 *
 * The source text is re-read here (not passed in): on the internet path phase
 * 2's tool just wrote it during fetch, so the scheduler's in-memory copy would
 * be stale.
 */
export async function rewriteChapter(
  threadId: string,
  chapterNumber: number,
  options: DehydrateConfig["options"],
  signal?: AbortSignal,
): Promise<RewriteOutcome> {
  // Own the rewrite-row lifecycle: mark in-progress (insert fresh or reset stale).
  const existing = entertainmentService.getRewrittenChapter(
    threadId,
    chapterNumber,
  );
  if (!existing) {
    entertainmentService.insertRewrittenChapter({
      threadId,
      chapterNumber,
      status: "rewriting",
    });
  } else {
    entertainmentService.updateRewrittenChapter(threadId, chapterNumber, {
      status: "rewriting",
    });
  }

  const sourceText =
    entertainmentService.getSourceChapter(threadId, chapterNumber)?.content ??
    "";

  logger.info("rewriting", {
    threadId,
    chapterNumber,
    sourceLen: sourceText.length,
  });

  const basePrompt = buildDehydrateSystemPrompt(options, "single");
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
        "rewrite stopped without outputProcessedContent; retrying once",
        {
          threadId,
          chapterNumber,
        },
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
    logger.error("rewrite ended without calling outputProcessedContent", {
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

