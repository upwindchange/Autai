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

import { streamText, stepCountIs, tool, generateText } from "ai";
import type { LanguageModel } from "ai";
import { z } from "zod";
import log from "electron-log/main";
import {
  complexModel,
  forwardSamplingParams,
  reasoningProviderOptions,
  type ResolvedModel,
} from "@agents/providers";
import { hasSuccessfulToolResult, TIMEOUTS } from "@agents/utils";
import {
  settingsService,
  entertainmentFrontendService,
  entertainmentBackendService,
} from "@/services";
import { buildDehydrateSystemPrompt } from "../shared/dehydratePrompt";

const logger = log.scope("Dehydrate:Pipeline1:Runner");

/**
 * Hard flat cap (in CHARS) on how much original text one pass ingests. Keeps
 * each pass bounded even on huge-context models. The effective per-pass budget
 * is the min of this, the model's max-output (in chars), and 1/5 of the context
 * window (in chars) — see `computeBudget`.
 */
const MAX_INPUT_CHARS = 200_000;

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
      experimental_telemetry: {
        isEnabled: settingsService.settings.langfuse.enabled,
        functionId: "entertainment-pipeline1-probe",
        metadata: { threadId, sampleChars: sample.length },
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
// Terminal tool: outputChapters
// ---------------------------------------------------------------------------

interface OutputChaptersContext {
  threadId: string;
  /** Char offset into rawText where this pass's chunk STARTS. */
  chunkStart: number;
  /** Length (chars) of this pass's chunk. The tool advances rawConsumedOffset
   *  by exactly this — the whole chunk is consumed regardless of how the agent
   *  re-chapters it. */
  chunkLength: number;
  /** True when this chunk reaches EOF — the tool finalizes the thread on it. */
  isLastBatch: boolean;
}

/**
 * `outputChapters` — the ONLY way the agent delivers its result. One call per
 * pass: an array of `{ title, content }`, one entry per chapter the
 * agent chose to produce from the chunk. Execute is fully deterministic:
 *   - assigns sequential chapter numbers continuing from the last one in the DB
 *     (`maxRewrittenChapterNumber + 1`, read at execute time → gap-free across
 *     passes and crash-resume);
 *   - inserts the rewritten_chapters row FIRST, then the source_chapters row
 *     (which carries the title the reader joins in for the TOC + app header);
 *   - advances `rawConsumedOffset` to `chunkStart + chunkLength` (the recovery
 *     checkpoint — recoverable after power-off);
 *   - on the last batch, sets `finalChapterNumber` (the full chapter count is
 *     known once the final chunk's rows land).
 * `threadId` / `chunkStart` / `chunkLength` / `isLastBatch` arrive via
 * `experimental_context` (zero-token — never in the prompt).
 */
const outputChaptersTool = tool({
  description:
    "The ONLY way to end your output and deliver the chapters — " +
    "call this outputChapters tool with an array of chapters, each carrying " +
    "`title` (the source chapter range + a short reader-facing name) and " +
    "`content` (the full dehydrated/rewritten prose). " +
    "You are NOT ALLOWED to output the prose as plain text and stop; it must " +
    "go through this outputChapters tool.",
  inputSchema: z.object({
    chapters: z
      .array(
        z.object({
          title: z
            .string()
            .min(1)
            .describe(
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
                "number separately.",
            ),
          content: z
            .string()
            .min(1)
            .describe(
              "The full dehydrated/rewritten chapter prose, content only " +
                "(no title, no Markdown, no explanations).",
            ),
        }),
      )
      .min(1),
  }),
  execute: async (input, { experimental_context }) => {
    const ctx = experimental_context as OutputChaptersContext;
    const startNum =
      entertainmentBackendService.maxRewrittenChapterNumber(ctx.threadId) + 1;
    for (let i = 0; i < input.chapters.length; i++) {
      const ch = input.chapters[i];
      const n = startNum + i;
      // rewritten_chapters row first, then the source_chapters row (title).
      entertainmentBackendService.insertRewrittenChapter({
        threadId: ctx.threadId,
        chapterNumber: n,
        content: ch.content,
        status: "rewritten",
      });
      // The source_chapters row carries the chapter title, which the reader
      // joins in for the TOC + app header. status="fetched" is benign here —
      // the reader's phase derivation returns "success" for rewritten chapters
      // before ever consulting sourceStatus, and there is no "view original"
      // affordance. url/content stay null: a file upload has no source URL and
      // the reader never renders 原文.
      entertainmentBackendService.insertSourceChapter({
        threadId: ctx.threadId,
        chapterNumber: n,
        title: ch.title,
        status: "fetched",
      });
    }
    const newOffset = ctx.chunkStart + ctx.chunkLength;
    entertainmentBackendService.setConsumedOffset(ctx.threadId, newOffset);
    if (ctx.isLastBatch) {
      entertainmentBackendService.setFinalChapterNumber(
        ctx.threadId,
        startNum + input.chapters.length - 1,
      );
    }
    entertainmentBackendService.touchThread(ctx.threadId);
    logger.info("chapters committed", {
      threadId: ctx.threadId,
      saved: input.chapters.length,
      newOffset,
      isLastBatch: ctx.isLastBatch,
    });
    return { saved: input.chapters.length };
  },
});

/**
 * Reinforcement appended on the one-shot retry when the agent stopped without
 * calling `outputChapters` (it streamed prose as plain text). Tells the model
 * the plain-text output was discarded and it must hand the chapters back
 * through the tool.
 */
const RETRY_SUFFIX = `

## ⚠ Your previous submission was invalid — you must resubmit through the tool
Your last response did not call the outputChapters tool; instead, you stopped after emitting plain text. Plain text is not accepted, so the result is invalid. Please resubmit now: call the outputChapters tool with an array of chapters, each carrying \`title\` (the source chapter range in the source's own numbering convention + the evocative name) and \`content\` (the full dehydrated prose). Do not output plain text, and do not write any prose outside of the tool call.`;

// ---------------------------------------------------------------------------
// One agent pass
// ---------------------------------------------------------------------------

async function runDehydrateAgent(params: {
  resolved: ResolvedModel;
  systemPrompt: string;
  chunk: string;
  ctx: OutputChaptersContext;
  signal: AbortSignal;
}): Promise<boolean> {
  const { resolved, systemPrompt, chunk, ctx, signal } = params;
  const sampling = forwardSamplingParams(resolved.params);
  const reasoning = reasoningProviderOptions(
    resolved.params,
    resolved.model,
    resolved.npm,
  );
  const result = streamText({
    model: resolved.model,
    system: systemPrompt,
    messages: [{ role: "user", content: chunk }],
    tools: { outputChapters: outputChaptersTool },
    toolChoice: { type: "tool", toolName: "outputChapters" },
    stopWhen: [hasSuccessfulToolResult("outputChapters"), stepCountIs(3)],
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
    experimental_context: ctx,
    experimental_telemetry: {
      isEnabled: settingsService.settings.langfuse.enabled,
      functionId: "entertainment-pipeline1-dehydrate",
      metadata: { threadId: ctx.threadId },
    },
  });
  const steps = await result.steps;
  return steps
    .flatMap((s) => s.toolResults ?? [])
    .some(
      (tr) => tr.toolName === "outputChapters" && tr.type === "tool-result",
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
    const ctx: OutputChaptersContext = {
      threadId,
      chunkStart,
      chunkLength: chunk.length,
      isLastBatch,
    };

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
    });

    let saved = false;
    try {
      saved = await runDehydrateAgent({
        resolved,
        systemPrompt,
        chunk,
        ctx,
        signal,
      });
      if (!saved && !signal.aborted) {
        logger.warn("pass stopped without outputChapters; retrying once", {
          threadId,
          pass,
        });
        saved = await runDehydrateAgent({
          resolved,
          systemPrompt: systemPrompt + RETRY_SUFFIX,
          chunk,
          ctx,
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
