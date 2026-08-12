/**
 * Chaptered-file ONE-PASS dehydrate runner.
 *
 * A single autonomous loop. Each pass reads a bounded chunk of the decoded
 * novel (`entertainment_configs.rawText`) and runs ONE agent call whose
 * terminal `outputChapters` tool emits an array of `{ title, content }`
 * pairs — the agent re-chapters, merges, and dehydrates as it sees fit
 * (typically producing FEWER chapters than the source). Title + rewrite are
 * produced together in that one tool call. The title lands in `source_chapters`
 * so the reader's TOC + app header can show it.
 *
 * Resumable + recoverable: every pass advances `rawConsumedOffset` (inside the
 * tool, deterministically), so a crashed/killed run picks up from the last
 * committed chunk on the next thread-open. `rawText` is held in the DB until
 * EOF so crash-resume can re-read it without touching the source file.
 *
 * Honors Abort: the caller passes an AbortSignal; the loop checks it between
 * passes and the in-flight `streamText` aborts mid-pass. An abort exits quietly
 * (no failure alert); a genuine failure (no tool call after retry, or a thrown
 * error) alerts + leaves `rawConsumedOffset` and `rawText` untouched so the
 * next open retries the same chunk.
 *
 * Per-pass settings: the model is re-resolved (`complexModel()`) and the
 * dehydrate options re-read (`getParsedConfig`) on EVERY pass, so a mid-run
 * change to the global complex model or to the reader's Options (PUT /config)
 * takes effect on the next pass.
 */

import { streamText, isStepCount, tool, generateText } from "ai";
import type { LanguageModel } from "ai";
import { z } from "zod";
import log from "electron-log/main";
import {
  complexModel,
  forwardSamplingParams,
  reasoningProviderOptions,
  type ResolvedModel,
} from "@agents/providers";
import { TIMEOUTS } from "@agents/utils";
import {
  settingsService,
  entertainmentFrontendService,
  entertainmentBackendService,
} from "@/services";
import { buildDehydrateSystemPrompt } from "../shared/dehydratePrompt";
import type { RewrittenChapterStatus } from "@shared";

const logger = log.scope("Dehydrate:Pipeline1:Runner");

/**
 * Hard flat cap (in CHARS) on how much original text one pass ingests. Bounds
 * the worst-case loss from a silent partial skip (one chapter out of a handful,
 * not dozens) and keeps each pass bounded even on huge-context models. The
 * effective per-pass budget is the min of this, the model's max-output (in
 * chars), and 1/5 of the context window (in chars) — see `computeBudget`.
 */
const MAX_INPUT_CHARS = 30_000;

/**
 * Number of characters of raw text sent in the one-shot chars-per-token probe.
 * Enough to sample the content's density; small enough to cost ~1k tokens.
 */
const PROBE_SAMPLE_CHARS = 4000;

/**
 * Conservative fallback chars-per-token when the probe fails (network/rate-
 * limit). Chinese-optimised models land ~0.5–0.8; 0.5 sizes the first pass
 * small and safe. The probe is the only measurement — there is no per-pass
 * re-calibration.
 */
const PROBE_FALLBACK_CHARS_PER_TOKEN = 0.5;

/** Safety cap on passes so a state bug can't loop forever. */
const MAX_PASSES = 10_000;

/**
 * Fast start-up: the first few batches ingest only this many chars each — a
 * touch over one ~3000-char source chapter (≈1:1 chars-per-token for Chinese) —
 * so the reader gets opening chapters to read almost immediately instead of
 * waiting for a full-size batch to finish. After `FAST_STARTUP_PASSES` batches
 * the loop switches to the model's full computed budget for the rest of the
 * book. Gated on consumed offset (not the pass index), so it is resume-safe: a
 * reopened run never re-triggers fast start-up once the opening batches are done.
 */
const FAST_STARTUP_CHARS = 4000;
const FAST_STARTUP_PASSES = 3;

// ---------------------------------------------------------------------------
// chars-per-token probe (one-shot, preserved from the former textChunker)
// ---------------------------------------------------------------------------

/**
 * Measure the model's REAL chars-per-token for this novel's content via a single
 * minimal probe call: send a small raw-text sample (no system prompt, no tools)
 * and read back `usage.inputTokens`; `sampleChars / inputTokens` is the true
 * density under the model's tokenizer. Returns `null` on any failure (caller
 * falls back to `PROBE_FALLBACK_CHARS_PER_TOKEN`). Used ONCE before the loop —
 * no per-pass re-calibration.
 */
async function probeCharsPerToken(
  model: LanguageModel,
  rawText: string,
  threadId: string,
): Promise<number | null> {
  if (!rawText) return null;
  const sample = rawText.slice(0, PROBE_SAMPLE_CHARS);
  if (!sample) return null;
  try {
    const result = await generateText({
      model,
      prompt: sample,
      maxOutputTokens: 1,
      maxRetries: settingsService.settings.maxRetries,
      timeout: TIMEOUTS.chat,
      telemetry: {
        isEnabled: settingsService.settings.langfuse.enabled,
        functionId: "entertainment-pipeline1-probe",
      },
    });
    const inputTokens = result.usage?.inputTokens;
    if (!inputTokens || inputTokens <= 0) {
      logger.warn("probe returned no inputTokens", {
        threadId,
        sampleChars: sample.length,
      });
      return null;
    }
    const cpt = sample.length / inputTokens;
    if (!Number.isFinite(cpt) || cpt <= 0) return null;
    logger.info("probe measured chars-per-token", {
      threadId,
      sampleChars: sample.length,
      inputTokens,
      charsPerToken: cpt,
    });
    return cpt;
  } catch (err) {
    logger.warn("probe failed; falling back to conservative ratio", {
      threadId,
      sampleChars: sample.length,
      err,
    });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Per-pass input budget
// ---------------------------------------------------------------------------

/**
 * The max chars of original text one pass ingests:
 *   min(MAX_INPUT_CHARS, maxOutputTokens → chars, contextWindow/5 → chars).
 * Capping by `maxOutputTokens → chars` guarantees the dehydrated output (≤ input
 * size) fits the model's output budget; capping by `contextWindow/5 → chars`
 * keeps the whole request (input + output + overhead) well inside the context
 * window. `maxOutputTokens` is optional — when absent only the other two apply.
 */
function computeBudget(resolved: ResolvedModel, charsPerToken: number): number {
  const maxOutputChars =
    resolved.maxOutputTokens != null ?
      resolved.maxOutputTokens * charsPerToken
    : Number.POSITIVE_INFINITY;
  const contextChars = (resolved.contextWindow * charsPerToken) / 5;
  return Math.min(MAX_INPUT_CHARS, maxOutputChars, contextChars);
}

// ---------------------------------------------------------------------------
// Per-pass staging + two tools: outputChapter (stage) + terminate (flush)
// ---------------------------------------------------------------------------

/**
 * Per-pass RAM staging buffer. Created fresh at the start of each pass (local
 * to the pass), passed into both tools via `toolsContext`. An interrupted pass
 * simply never calls `terminate`, so the staging is discarded with the pass —
 * crash-safe by construction (no partial DB state).
 */
interface PassStage {
  threadId: string;
  /** Char offset into rawText where this pass's chunk STARTS. */
  chunkStart: number;
  /** Length (chars) of this pass's chunk. */
  chunkLength: number;
  /** True when this chunk reaches EOF — the terminate chapter gets `rewritten`
   *  (not `to_be_continued`) AND `finalChapterNumber` is set. */
  isLastBatch: boolean;
  /** Sequential chapter numbers this pass will write, continuing from the DB.
   *  When lead-in is present, this is the PRIOR `to_be_continued` chapter's
   *  number (the first outputChapter REPLACES that row in place). */
  startNum: number;
  /** When non-null, the first staged chapter lands on an EXISTING row (the
   *  prior pass's `to_be_continued` chapter whose content was prepended as
   *  lead-in). `flushDehydratePass` UPDATEs instead of INSERTing it. */
  replaceAtChapterNumber: number | null;
  /** Staged chapters in emit order. */
  chapters: { title: string; content: string }[];
}

/** Shared field schemas (identical for outputChapter + terminate). */
const TITLE_DESC =
  "Reader-facing chapter title for THIS dehydrated chapter = the " +
  "source chapter range + the evocative name. Read the original " +
  "chapter headings in the input to see which source chapters you " +
  "merged AND the numbering convention they use, then copy that " +
  "convention exactly (number format, script, and language — do not " +
  "translate or romanize it). Examples of the SAME title under " +
  "different sources' conventions: '第三十一至三十五章 风起天南', " +
  "'Chapter 31–35 The Storm', '第31〜35章 嵐の夜'. One source chapter " +
  "→ no range, just that heading's number. Do NOT include a new " +
  "sequential output number — the app renders its own chapter " +
  "number separately.";
const CONTENT_DESC =
  "The full dehydrated/rewritten chapter prose, content only " +
  "(no title, no Markdown, no explanations).";

/**
 * `outputChapter` — stage ONE completed chapter from the input chunk. Call this
 * once per chapter you produce. The chapter is staged internally; you will NOT
 * see it again. After your final chapter of this chunk, call the `terminate`
 * tool instead of this one. Never emit prose as plain text.
 */
const outputChapterTool = tool({
  description:
    "Output ONE completed dehydrated chapter from the input chunk. Call this " +
    "once per chapter you produce. The chapter is staged internally; you will " +
    "NOT see it again. After your final chapter of this chunk, call the " +
    "`terminate` tool instead of this one. Never emit prose as plain text.",
  inputSchema: z.object({
    title: z.string().min(1).describe(TITLE_DESC),
    content: z.string().min(1).describe(CONTENT_DESC),
  }),
  contextSchema: z.object({ stage: z.custom<PassStage>() }),
  execute: async (input, { context: ctx }) => {
    ctx.stage.chapters.push({ title: input.title, content: input.content });
    return { staged: ctx.stage.chapters.length };
  },
});

/**
 * `terminate` — emit the FINAL chapter of this input chunk AND signal
 * completion. This is the chapter that covers the point where the raw input
 * text cuts off — shape its ending as a clean continuation point. After this
 * call the pass ends; do not call outputChapter again. Use terminate instead of
 * outputChapter ONLY for the last chapter of the chunk. Never emit prose as
 * plain text.
 *
 * Execute: gross-coverage tripwire (refuses to flush if output is absurdly
 * small vs input), then atomically flushes all staged chapters + offset advance
 * + optional final-chapter number + thread touch in ONE transaction.
 */
const terminateTool = tool({
  description:
    "Emit the FINAL chapter of this input chunk AND signal completion. This is " +
    "the chapter that covers the point where the raw input text cuts off — " +
    "shape its ending as a clean continuation point. After this call the pass " +
    "ends; do not call outputChapter again. Use terminate instead of " +
    "outputChapter ONLY for the last chapter of the chunk. Never emit prose as " +
    "plain text.",
  inputSchema: z.object({
    title: z.string().min(1).describe(TITLE_DESC),
    content: z.string().min(1).describe(CONTENT_DESC),
  }),
  contextSchema: z.object({ stage: z.custom<PassStage>() }),
  execute: async (input, { context: ctx }) => {
    const s = ctx.stage;
    s.chapters.push({ title: input.title, content: input.content });
    // Gross-coverage tripwire: refuse to flush if output is absurdly small vs
    // input. Return an error result so the model sees it and keeps going (the
    // SDK feeds tool errors back into the next step). Do NOT flush, do NOT
    // advance.
    const emittedChars = s.chapters.reduce((a, c) => a + c.content.length, 0);
    if (emittedChars < s.chunkLength * 0.02) {
      return {
        error: "insufficient_coverage",
        emittedChars,
        chunkChars: s.chunkLength,
        message:
          `You have emitted ${emittedChars} chars for a ${s.chunkLength}-char ` +
          `input chunk — that is far too little. You must cover the WHOLE input. ` +
          `Continue producing the missing chapters with outputChapter, then call ` +
          `terminate again only when the entire input has been covered.`,
      };
    }
    // Assign sequential numbers continuing from the DB.
    const rows = s.chapters.map((c, i) => ({
      chapterNumber: s.startNum + i,
      title: c.title,
      content: c.content,
      rewriteStatus: (i === s.chapters.length - 1
        ? (s.isLastBatch ? "rewritten" : "to_be_continued")
        : "rewritten") as RewrittenChapterStatus,
    }));
    entertainmentBackendService.flushDehydratePass({
      threadId: s.threadId,
      chapters: rows,
      newOffset: s.chunkStart + s.chunkLength,
      ...(s.replaceAtChapterNumber != null && {
        replaceAtChapterNumber: s.replaceAtChapterNumber,
      }),
      ...(s.isLastBatch && {
        finalChapterNumber: rows[rows.length - 1].chapterNumber,
      }),
    });
    logger.info("dehydrate pass flushed", {
      threadId: s.threadId,
      saved: rows.length,
      newOffset: s.chunkStart + s.chunkLength,
      isLastBatch: s.isLastBatch,
      chunkStart: s.chunkStart,
      chunkLength: s.chunkLength,
      lastStatus: rows[rows.length - 1].rewriteStatus,
      replaceAt: s.replaceAtChapterNumber,
      chapterLengths: rows.map((r) => ({
        n: r.chapterNumber,
        titleLen: r.title.length,
        contentLen: r.content.length,
      })),
    });
    return { saved: rows.length, terminated: true };
  },
});

/**
 * Stop condition: the last step produced a successful (non-error) `terminate`
 * tool result. Mirrors `hasSuccessfulToolResult` but additionally requires the
 * result NOT to carry an `error` field (the tripwire returns an error object,
 * which is still `type: "tool-result"` but must NOT satisfy the stop condition).
 */
function terminatedSuccessfully({ steps }: { steps: { toolResults?: Array<{ toolName: string; type: string; output: unknown }> }[] }): boolean {
  return (
    steps[steps.length - 1]?.toolResults?.some((r) => {
      if (r.toolName !== "terminate" || r.type !== "tool-result") return false;
      const output = r.output as Record<string, unknown> | undefined;
      return !output?.error;
    }) ?? false
  );
}

/**
 * Reinforcement appended on the one-shot retry when the agent stopped without
 * calling `outputChapter` / `terminate` (it streamed prose as plain text).
 * Tells the model the plain-text output was discarded and it must hand the
 * chapters back through the tools.
 */
const RETRY_SUFFIX = `

## ⚠ Your previous submission was invalid — you must resubmit through the tools
Your last response did not call outputChapter or terminate; instead you stopped
after emitting plain text. Plain text is not accepted. Resubmit now: call
outputChapter for each completed chapter, then terminate with the final chapter
that covers the end of the input chunk.`;

// ---------------------------------------------------------------------------
// One agent pass
// ---------------------------------------------------------------------------

async function runDehydrateAgent(params: {
  resolved: ResolvedModel;
  systemPrompt: string;
  userContent: string;
  stage: PassStage;
  maxSteps: number;
  signal: AbortSignal;
}): Promise<boolean> {
  const { resolved, userContent, stage, maxSteps, signal } = params;
  const sampling = forwardSamplingParams(resolved.params);
  const reasoning = reasoningProviderOptions(
    resolved.params,
    resolved.model,
    resolved.npm,
  );
  const result = streamText({
    model: resolved.model,
    messages: [{ role: "user", content: userContent }],
    tools: { outputChapter: outputChapterTool, terminate: terminateTool },
    // Free choice across the loop — the model picks outputChapter or terminate.
    stopWhen: [terminatedSuccessfully, isStepCount(maxSteps)],
    maxRetries: settingsService.settings.maxRetries,
    timeout: TIMEOUTS.novel,
    abortSignal: signal,
    // Sampling first, then the catalog maxOutputTokens wins (the agent needs the
    // full output budget to emit the chapter prose for the whole chunk).
    ...sampling,
    ...(resolved.maxOutputTokens != null && {
      maxOutputTokens: resolved.maxOutputTokens,
    }),
    ...(reasoning && { providerOptions: reasoning }),
    toolsContext: { outputChapter: { stage }, terminate: { stage } },
    telemetry: {
      isEnabled: settingsService.settings.langfuse.enabled,
      functionId: "entertainment-pipeline1-dehydrate",
    },
  });
  const steps = await result.steps;
  // Diagnostic: dump the full reasoning, plain text, and tool-call arguments
  // for each step so we can see exactly what the model thought and emitted.
  for (const step of steps) {
    const u = step.usage;
    logger.silly("agent step result", {
      threadId: stage.threadId,
      stepNumber: step.stepNumber,
      provider: step.model.provider,
      modelId: step.model.modelId,
      finishReason: step.finishReason,
      rawFinishReason: step.rawFinishReason,
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      totalTokens: u.totalTokens,
      reasoningTokens: u.outputTokenDetails?.reasoningTokens,
      textLen: step.text.length,
      toolCallNames: step.toolCalls.map((tc) => tc.toolName),
      hasToolResults: (step.toolResults ?? []).length > 0,
    });
    if (step.reasoningText) {
      logger.silly("agent step reasoning", {
        threadId: stage.threadId,
        stepNumber: step.stepNumber,
        reasoningText: step.reasoningText,
      });
    }
    if (step.text) {
      logger.silly("agent step text", {
        threadId: stage.threadId,
        stepNumber: step.stepNumber,
        text: step.text,
      });
    }
    for (const tc of step.toolCalls) {
      logger.silly("agent step tool call", {
        threadId: stage.threadId,
        stepNumber: step.stepNumber,
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        input: JSON.stringify(tc.input),
      });
    }
  }
  // `saved` = terminate flushed successfully (a non-error terminate result).
  return steps.some((s) =>
    (s.toolResults ?? []).some((r) => {
      if (r.toolName !== "terminate" || r.type !== "tool-result") return false;
      const output = r.output as Record<string, unknown> | undefined;
      return !output?.error;
    }),
  );
}

// ---------------------------------------------------------------------------
// The loop (public entry)
// ---------------------------------------------------------------------------

/**
 * Run the one-pass dehydrate loop for a thread until EOF, abort, or a transient
 * failure. Autonomous + resumable + abortable. The caller owns the
 * AbortController; this function just drives passes.
 */
export async function runDehydrateLoop(
  threadId: string,
  signal: AbortSignal,
): Promise<void> {
  const rawText = entertainmentBackendService.getRawNovelText(threadId);
  if (!rawText || rawText.length === 0) {
    logger.warn("no raw text; nothing to dehydrate", { threadId });
    return;
  }

  // Probe once (may throw if no complex model is configured → propagates to the
  // caller, which surfaces a warning toast).
  const probeResolved = complexModel();
  const probeCpt = await probeCharsPerToken(
    probeResolved.model,
    rawText,
    threadId,
  );
  const charsPerToken = probeCpt ?? PROBE_FALLBACK_CHARS_PER_TOKEN;

  logger.info("dehydrate loop initialized", {
    threadId,
    rawTextLen: rawText.length,
    probeCharsPerToken: probeCpt,
    probeFallback: probeCpt == null,
    charsPerToken,
    resume: entertainmentBackendService.getConsumedOffset(threadId) > 0,
  });

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    if (signal.aborted) {
      logger.info("dehydrate loop aborted by stop", { threadId, pass });
      return;
    }

    const consumedOffset =
      entertainmentBackendService.getConsumedOffset(threadId);
    if (consumedOffset >= rawText.length) {
      // EOF: the final chunk's tool already set finalChapterNumber; finalize
      // defensively + drop the raw blob (an interrupted run kept it for resume).
      const final =
        entertainmentBackendService.maxRewrittenChapterNumber(threadId);
      if (
        final > 0 &&
        entertainmentFrontendService.getFinalChapterNumber(threadId) == null
      ) {
        entertainmentBackendService.setFinalChapterNumber(threadId, final);
      }
      entertainmentBackendService.clearRawNovelText(threadId);
      logger.info("dehydrate loop reached EOF", {
        threadId,
        pass,
        finalChapter: final,
      });
      return;
    }

    // Re-resolve per pass: picks up model + dehydrate-option changes mid-run.
    const resolved = complexModel();
    const config = entertainmentFrontendService.getParsedConfig(threadId);
    if (!config) {
      logger.warn("no parsed config; stopping loop", { threadId, pass });
      return;
    }

    // Fast start-up: while the opening batches are still within the first
    // FAST_STARTUP_PASSES × FAST_STARTUP_CHARS chars, cap each batch to
    // FAST_STARTUP_CHARS so the reader gets chapters quickly. After that the
    // model's full computed budget takes over. Gated on offset (not pass) so a
    // resumed run never re-triggers fast start-up past the opening batches.
    const fullBudget = computeBudget(resolved, charsPerToken);
    const fastStartup =
      consumedOffset < FAST_STARTUP_CHARS * FAST_STARTUP_PASSES;
    const budget =
      fastStartup ? Math.min(fullBudget, FAST_STARTUP_CHARS) : fullBudget;
    const chunkStart = consumedOffset;
    const chunkEnd = Math.min(rawText.length, chunkStart + budget);
    const chunk = rawText.slice(chunkStart, chunkEnd);
    const isLastBatch = chunkEnd >= rawText.length;
    const systemPrompt = buildDehydrateSystemPrompt(config.options, "multi");

    // Lead-in: if the previous pass ended with a `to_be_continued` chapter,
    // prepend its content so the model continues the scene coherently. The
    // model's first outputChapter of THIS pass replaces that row in place
    // (same chapter number) with lead-in + continued text merged.
    const priorMax =
      entertainmentBackendService.maxRewrittenChapterNumber(threadId);
    let leadIn: { chapterNumber: number; content: string } | null = null;
    if (priorMax > 0) {
      const priorRow =
        entertainmentFrontendService.getRewrittenChapter(threadId, priorMax);
      if (priorRow && priorRow.status === "to_be_continued") {
        leadIn = {
          chapterNumber: priorMax,
          content: priorRow.content ?? "",
        };
      }
    }

    const userContent = leadIn
      ? `【上一章续写】以下是你上一段处理的结尾（章节 ${leadIn.chapterNumber}），请基于它续写，保持连贯；本段你产出的第一章将替换该章，合并上一章结尾与本段续写内容，使用相同的章节号 ${leadIn.chapterNumber}：\n\n${leadIn.content}\n\n【本段原文】\n${chunk}`
      : chunk;

    const startNum = leadIn ? leadIn.chapterNumber : priorMax + 1;
    const stage: PassStage = {
      threadId,
      chunkStart,
      chunkLength: chunk.length,
      isLastBatch,
      startNum,
      replaceAtChapterNumber: leadIn?.chapterNumber ?? null,
      chapters: [],
    };

    // Scaled step count: ~one step per expected chapter (~2500 chars/chapter)
    // + retry headroom. Generous so it never cuts off a well-behaved pass; the
    // coverage tripwire is the real safety net.
    const targetChapters = Math.max(2, Math.ceil(chunk.length / 2500));
    const maxSteps = targetChapters * 3 + 4;

    logger.debug("dehydrate pass planned", {
      threadId,
      pass,
      chunkStart,
      chunkEnd,
      chunkLen: chunk.length,
      budget,
      fastStartup,
      isLastBatch,
      charsPerToken,
      leadIn: leadIn ? leadIn.chapterNumber : null,
      startNum,
      maxSteps,
    });

    let saved = false;
    try {
      saved = await runDehydrateAgent({
        resolved,
        systemPrompt,
        userContent,
        stage,
        maxSteps,
        signal,
      });
      if (!saved && !signal.aborted) {
        logger.warn("pass stopped without terminate; retrying once", {
          threadId,
          pass,
        });
        // Fresh stage for the retry — the prior attempt's staging is discarded.
        const retryStage: PassStage = { ...stage, chapters: [] };
        saved = await runDehydrateAgent({
          resolved,
          systemPrompt: systemPrompt + RETRY_SUFFIX,
          userContent,
          stage: retryStage,
          maxSteps,
          signal,
        });
      }
    } catch (err) {
      logger.error("dehydrate pass threw", { threadId, pass, err });
    }

    if (signal.aborted) {
      logger.info("dehydrate loop aborted by stop", { threadId, pass });
      return;
    }

    if (!saved) {
      // Transient failure (no tool call after retry, or a thrown error). Do NOT
      // advance rawConsumedOffset and do NOT clear rawText — leave everything
      // untouched so reopening the thread retries the same chunk.
      logger.error("dehydrate pass failed; stopping for user retry", {
        threadId,
        pass,
        chunkStart,
        chunkEnd,
      });
      return;
    }
  }

  logger.warn("dehydrate loop hit MAX_PASSES safety cap", { threadId });
}
