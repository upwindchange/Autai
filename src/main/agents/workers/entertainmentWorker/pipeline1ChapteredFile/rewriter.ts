/**
 * Chaptered-file ONE-PASS dehydrate runner.
 *
 * A single autonomous loop. Each pass reads a bounded chunk of the decoded
 * novel (`entertainment_configs.rawText`) and runs ONE agent call with two
 * tools: every `outputChapter` call writes ONE completed chapter to the DB
 * immediately (drip — readers see each chapter the moment the model produces
 * it), and the single `terminate` call writes the FINAL chapter + advances
 * `rawConsumedOffset` atomically. The agent re-chapters, merges, and
 * dehydrates as it sees fit (typically producing FEWER chapters than the
 * source); the title lands in `source_chapters` so the reader's TOC + app
 * header can show it.
 *
 * Resumable + recoverable: chapters persist per drip while the offset
 * advances only at `terminate`, so a crashed/killed run keeps every dripped
 * chapter; reopening the thread replays the un-consumed chunk with a
 * storyline-continuation anchor (the last already-published chapter) so the
 * model continues after it instead of re-covering written plot. `rawText` is
 * held in the DB until EOF so crash-resume can re-read it.
 *
 * Honors Abort: the caller passes an AbortSignal; the loop checks it between
 * passes and the in-flight `streamText` aborts mid-pass. An abort exits quietly
 * (no failure alert); a genuine failure (no tool call after retry, or a thrown
 * error) alerts + leaves `rawConsumedOffset` and `rawText` untouched (dripped
 * chapters stay) so the next open retries the same chunk via the resume
 * anchor.
 *
 * Per-pass settings: the model is re-resolved (`complexModel()`) and the
 * dehydrate options re-read (`getParsedConfig`) on EVERY pass, so a mid-run
 * change to the global complex model or to the reader's Options (PUT /config)
 * takes effect on the next pass.
 *
 * Also serves non-chaptered file uploads (`nonNovelSource`): the multi
 * variant re-chapters from the text itself and needs no source chapter markers.
 */

import { streamText, isStepCount, tool, generateText } from "ai";
import { z } from "zod";
import log from "electron-log/main";
import {
  complexModel,
  forwardSamplingParams,
  customProviderOptions,
  type ResolvedModel,
} from "@agents/providers";
import { ENTERTAINMENT_AGENT_CONTROLS } from "../shared/modelControls";
import { TIMEOUTS } from "@agents/utils";
import {
  settingsService,
  entertainmentFrontendService,
  entertainmentBackendService,
} from "@/services";
import {
  buildDehydrateSystemPrompt,
  buildDehydrateLeadInUserContent,
} from "../shared/dehydratePrompt";
import type { RewrittenChapterStatus } from "@shared";

const logger = log.scope("Dehydrate:Rewriter:File");

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
  resolved: ResolvedModel,
  rawText: string,
  threadId: string,
): Promise<number | null> {
  if (!rawText) return null;
  const sample = rawText.slice(0, PROBE_SAMPLE_CHARS);
  if (!sample) return null;
  try {
    const providerOptions = customProviderOptions(
      resolved,
      ENTERTAINMENT_AGENT_CONTROLS,
    );
    const result = await generateText({
      model: resolved.model,
      prompt: sample,
      maxOutputTokens: 1,
      ...(providerOptions && { providerOptions }),
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
// Per-pass counters + two tools: outputChapter (drip) + terminate (final)
// ---------------------------------------------------------------------------

/**
 * Per-pass bookkeeping. Created fresh at the start of each pass (local to the
 * pass), passed into both tools via `toolsContext`. Chapters are written to
 * the DB inside each tool's `execute` (drip); the stage only tracks counters —
 * no chapter text is held here.
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
   *  When a `continue` lead-in is present, this is the PRIOR
   *  `to_be_continued` chapter's number (the first outputChapter REPLACES
   *  that row in place). */
  startNum: number;
  /** When non-null, the first dripped chapter lands on an EXISTING row (the
   *  prior pass's `to_be_continued` chapter whose content was prepended as
   *  lead-in). The DB write UPDATEs instead of INSERTing it. */
  replaceAtChapterNumber: number | null;
  /** Chapters written to the DB this pass so far (drip counter). */
  savedCount: number;
  /** Cumulative content chars emitted this pass (tripwire input). */
  emittedChars: number;
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
 * `outputChapter` — drip ONE completed chapter (see description): the write
 * happens inside this execute, so the chapter is reader-visible immediately.
 */
const outputChapterTool = tool({
  description:
    "Output ONE completed dehydrated chapter from the input chunk. Call this " +
    "once per chapter you produce, at most ONE call per message — never " +
    "batch multiple outputChapter calls; wait for each tool result before " +
    "emitting the next chapter. The chapter is saved to the reader's " +
    "library immediately; you will NOT see it again. After your final " +
    "chapter of this chunk, call the `terminate` tool instead of this one. " +
    "Never emit prose as plain text.",
  inputSchema: z.object({
    title: z.string().min(1).describe(TITLE_DESC),
    content: z.string().min(1).describe(CONTENT_DESC),
  }),
  contextSchema: z.object({ stage: z.custom<PassStage>() }),
  execute: async (input, { context: ctx }) => {
    const s = ctx.stage;
    const chapterNumber = s.startNum + s.savedCount;
    entertainmentBackendService.flushDehydrateChapter({
      threadId: s.threadId,
      chapterNumber,
      title: input.title,
      content: input.content,
      rewriteStatus: "rewritten",
      ...(s.savedCount === 0 && s.replaceAtChapterNumber != null && {
        replaceAtChapterNumber: s.replaceAtChapterNumber,
      }),
    });
    s.savedCount += 1;
    s.emittedChars += input.content.length;
    logger.info("dehydrate chapter dripped", {
      threadId: s.threadId,
      n: chapterNumber,
      titleLen: input.title.length,
      contentLen: input.content.length,
      replaced: s.replaceAtChapterNumber === chapterNumber,
    });
    return { saved: chapterNumber };
  },
});

/**
 * `terminate` — emit the FINAL chapter of the chunk and end the pass.
 * Execute: gross-coverage tripwire (refuses to terminate if the pass's
 * cumulative output is absurdly small vs input), then ONE atomic DB write:
 * final chapter + offset advance + optional final-chapter number + thread
 * touch in a single transaction.
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
    // Gross-coverage tripwire: refuse to terminate if the pass's cumulative
    // output is absurdly small vs input. Return an error result so the model
    // sees it and keeps going (the SDK feeds tool errors back into the next
    // step). Do NOT write the final chapter, do NOT advance.
    const emittedChars = s.emittedChars + input.content.length;
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
    const chapterNumber = s.startNum + s.savedCount;
    const lastStatus: RewrittenChapterStatus = s.isLastBatch ?
      "rewritten"
    : "to_be_continued";
    entertainmentBackendService.flushDehydrateTermination({
      threadId: s.threadId,
      chapterNumber,
      title: input.title,
      content: input.content,
      rewriteStatus: lastStatus,
      ...(s.savedCount === 0 && s.replaceAtChapterNumber != null && {
        replaceAtChapterNumber: s.replaceAtChapterNumber,
      }),
      newOffset: s.chunkStart + s.chunkLength,
      ...(s.isLastBatch && { finalChapterNumber: chapterNumber }),
    });
    s.savedCount += 1;
    s.emittedChars += input.content.length;
    logger.info("dehydrate pass flushed", {
      threadId: s.threadId,
      saved: s.savedCount,
      newOffset: s.chunkStart + s.chunkLength,
      isLastBatch: s.isLastBatch,
      chunkStart: s.chunkStart,
      chunkLength: s.chunkLength,
      lastStatus,
      replaceAt: s.replaceAtChapterNumber,
      emittedChars: s.emittedChars,
    });
    return { saved: chapterNumber, terminated: true };
  },
});

/**
 * One `terminate` tool result that flushed successfully — a `tool-result` for
 * `terminate` that does NOT carry an `error` field (the coverage tripwire
 * returns an error object, which is still `type: "tool-result"` but must NOT
 * count as success).
 */
function isSuccessfulTerminate(r: {
  toolName: string;
  type: string;
  output: unknown;
}): boolean {
  if (r.toolName !== "terminate" || r.type !== "tool-result") return false;
  const output = r.output as Record<string, unknown> | undefined;
  return !output?.error;
}

/**
 * Stop condition: the last step produced a successful (non-error) `terminate`
 * tool result.
 */
function terminatedSuccessfully({
  steps,
}: {
  steps: {
    toolResults?: Array<{ toolName: string; type: string; output: unknown }>;
  }[];
}): boolean {
  return (
    steps[steps.length - 1]?.toolResults?.some(isSuccessfulTerminate) ?? false
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
  const { resolved, systemPrompt, userContent, stage, maxSteps, signal } =
    params;
  const sampling = forwardSamplingParams(resolved.params);
  const providerOptions = customProviderOptions(resolved, {
    ...ENTERTAINMENT_AGENT_CONTROLS,
    disallowParallelToolCalls: true,
  });
  const result = streamText({
    model: resolved.model,
    instructions: systemPrompt,
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
    ...(providerOptions && { providerOptions }),
    toolsContext: { outputChapter: { stage }, terminate: { stage } },
    telemetry: {
      isEnabled: settingsService.settings.langfuse.enabled,
      functionId: "entertainment-pipeline1-dehydrate",
    },
  });
  const steps = await result.steps;
  // One compact per-step trace at silly level — enough to see which tool calls
  // fired and how tokens were spent; full prompts/results live in telemetry.
  for (const step of steps) {
    logger.silly("agent step", {
      threadId: stage.threadId,
      stepNumber: step.stepNumber,
      finishReason: step.finishReason,
      usage: step.usage,
      textLen: step.text.length,
      reasoningLen: step.reasoningText?.length ?? 0,
      toolCalls: step.toolCalls.map((tc) => ({
        toolName: tc.toolName,
        input: tc.input,
      })),
    });
  }
  // True = a successful terminate fired somewhere in this pass (the offset
  // advanced; any dripped chapters are already persisted regardless).
  return steps.some((s) => (s.toolResults ?? []).some(isSuccessfulTerminate));
}

// ---------------------------------------------------------------------------
// Pass planning (chunk + anchor derivation, rebuilt from live DB state)
// ---------------------------------------------------------------------------

/** Everything one pass needs, derived from CURRENT DB state. */
interface PassPlan {
  chunk: string;
  chunkStart: number;
  chunkEnd: number;
  chunkLength: number;
  isLastBatch: boolean;
  budget: number;
  systemPrompt: string;
  userContent: string;
  startNum: number;
  replaceAtChapterNumber: number | null;
  leadIn: { chapterNumber: number; kind: "continue" | "resume" } | null;
  maxSteps: number;
}

/**
 * Plan the next pass from live DB state. Rebuilt from scratch for the
 * one-shot retry — a partial first attempt may have dripped chapters
 * (advancing the DB's max chapter number), which changes the anchor,
 * startNum, and userContent. Returns `null` when the thread has no parsed
 * config.
 */
function preparePass(
  threadId: string,
  rawText: string,
  resolved: ResolvedModel,
  charsPerToken: number,
): PassPlan | null {
  const config = entertainmentFrontendService.getParsedConfig(threadId);
  if (!config) return null;

  const budget = computeBudget(resolved, charsPerToken);
  const chunkStart = entertainmentBackendService.getConsumedOffset(threadId);
  const chunkEnd = Math.min(rawText.length, chunkStart + budget);
  const chunk = rawText.slice(chunkStart, chunkEnd);
  const isLastBatch = chunkEnd >= rawText.length;
  const systemPrompt = buildDehydrateSystemPrompt(config.options, "multi");

  // Anchor derivation from the last written chapter:
  // - `to_be_continued` → `continue`: normal inter-pass flow. The pass's
  //   first outputChapter REPLACES that row in place (same number), merging
  //   the prior ending with the continuation.
  // - `rewritten` → `resume`: crash-resume mid-pass. The offset was never
  //   advanced, so this chunk re-covers raw text the anchor chapter (and
  //   earlier ones) already absorbed; the model locates the seam and
  //   continues AFTER the anchor, numbering its first chapter priorMax + 1.
  // - no prior chapter → plain chunk, no anchor. A `rewritten` max with
  //   `finalChapterNumber` set never reaches here — the loop exits at EOF
  //   before planning.
  const priorMax =
    entertainmentBackendService.maxRewrittenChapterNumber(threadId);
  let leadIn: PassPlan["leadIn"] = null;
  let startNum = priorMax + 1;
  let replaceAtChapterNumber: number | null = null;
  let userContent = chunk;
  if (priorMax > 0) {
    const priorRow = entertainmentFrontendService.getRewrittenChapter(
      threadId,
      priorMax,
    );
    if (priorRow?.status === "to_be_continued") {
      leadIn = { chapterNumber: priorMax, kind: "continue" };
      startNum = priorMax;
      replaceAtChapterNumber = priorMax;
      userContent = buildDehydrateLeadInUserContent({
        kind: "continue",
        chapterNumber: priorMax,
        content: priorRow.content ?? "",
        chunk,
      });
    } else if (priorRow?.status === "rewritten") {
      leadIn = { chapterNumber: priorMax, kind: "resume" };
      userContent = buildDehydrateLeadInUserContent({
        kind: "resume",
        chapterNumber: priorMax,
        content: priorRow.content ?? "",
        chunk,
      });
    }
  }

  // Scaled step count: ~one step per expected chapter (~2500 chars/chapter)
  // + retry headroom. Generous so it never cuts off a well-behaved pass; the
  // coverage tripwire is the real safety net.
  const targetChapters = Math.max(2, Math.ceil(chunk.length / 2500));

  return {
    chunk,
    chunkStart,
    chunkEnd,
    chunkLength: chunk.length,
    isLastBatch,
    budget,
    systemPrompt,
    userContent,
    startNum,
    replaceAtChapterNumber,
    leadIn,
    maxSteps: targetChapters * 3 + 4,
  };
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
    probeResolved,
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
    const plan = preparePass(threadId, rawText, resolved, charsPerToken);
    if (!plan) {
      logger.warn("no parsed config; stopping loop", { threadId, pass });
      return;
    }
    const { chunkStart, chunkEnd } = plan;

    const stage: PassStage = {
      threadId,
      chunkStart: plan.chunkStart,
      chunkLength: plan.chunkLength,
      isLastBatch: plan.isLastBatch,
      startNum: plan.startNum,
      replaceAtChapterNumber: plan.replaceAtChapterNumber,
      savedCount: 0,
      emittedChars: 0,
    };

    logger.debug("dehydrate pass planned", {
      threadId,
      pass,
      chunkStart: plan.chunkStart,
      chunkEnd: plan.chunkEnd,
      chunkLen: plan.chunkLength,
      budget: plan.budget,
      isLastBatch: plan.isLastBatch,
      charsPerToken,
      leadIn: plan.leadIn ? plan.leadIn.chapterNumber : null,
      leadInKind: plan.leadIn?.kind ?? null,
      startNum: plan.startNum,
      maxSteps: plan.maxSteps,
    });

    let completed = false;
    try {
      completed = await runDehydrateAgent({
        resolved,
        systemPrompt: plan.systemPrompt,
        userContent: plan.userContent,
        stage,
        maxSteps: plan.maxSteps,
        signal,
      });
      if (!completed && !signal.aborted) {
        logger.warn("pass stopped without terminate; retrying once", {
          threadId,
          pass,
        });
        // Rebuild EVERYTHING from live DB state — partial drips from the
        // first attempt advanced the DB's max chapter number, so the anchor
        // (resume), startNum, and userContent must be re-derived. The fresh
        // stage restarts the counters at zero; dripped chapters stay.
        const retryPlan = preparePass(
          threadId,
          rawText,
          resolved,
          charsPerToken,
        );
        if (!retryPlan) {
          logger.error("no parsed config on retry; stopping", {
            threadId,
            pass,
          });
          return;
        }
        const retryStage: PassStage = {
          threadId,
          chunkStart: retryPlan.chunkStart,
          chunkLength: retryPlan.chunkLength,
          isLastBatch: retryPlan.isLastBatch,
          startNum: retryPlan.startNum,
          replaceAtChapterNumber: retryPlan.replaceAtChapterNumber,
          savedCount: 0,
          emittedChars: 0,
        };
        completed = await runDehydrateAgent({
          resolved,
          systemPrompt: retryPlan.systemPrompt + RETRY_SUFFIX,
          userContent: retryPlan.userContent,
          stage: retryStage,
          maxSteps: retryPlan.maxSteps,
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

    if (!completed) {
      // Transient failure (no tool call after retry, or a thrown error). The
      // offset was never advanced and rawText stays — chapters already
      // dripped remain reader-visible, and reopening the thread continues
      // after them via the resume anchor. Stopping for user retry.
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
