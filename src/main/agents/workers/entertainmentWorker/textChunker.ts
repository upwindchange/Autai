import { generateText } from "ai";
import log from "electron-log/main";
import type { LanguageModel } from "ai";
import { settingsService } from "@/services";
import { TIMEOUTS } from "@agents/utils";

/**
 * Chunk-planning + paragraph-slicing logic for the outliner.
 *
 * The outliner (`outliner.ts`) wires this to the agent + DB; `fileDecoder.ts`
 * produces the rawText that flows in here.
 *
 * Two responsibilities:
 *   1. `planChunk` — given the model's context window, max output, fixed
 *      overheads (as CHARACTER counts), and how far we've already consumed,
 *      compute the next `[readStart, readEnd)` window of raw text to feed the
 *      agent. Sizing is driven by TWO ceilings — overflow prevention (the
 *      context window minus output + reserved) and dilution prevention (a
 *      target fraction of the window, Liu et al. 2023) — and takes the lower.
 *      There is NO overlap — chapter continuity between back-to-back rounds is
 *      provided by the outliner's 前情衔接 section (previous chapter's outline +
 *      last N paragraphs, untagged, with a `-1` merge sentinel the model may
 *      emit on its first entry; see outliner.ts).
 *   2. `sliceChapters` — paragraph-index → body slicer. The model emits, per
 *      storyline unit it can fully see, the LOCAL index of the unit's LAST
 *      paragraph (counting only the tagged `¶N¶` paragraphs in the new-text
 *      section, 0-based); this function slices the verbatim body by pure array
 *      indexing into the untagged paragraphs array the outliner passes via
 *      `experimental_context`. No string matching — body extraction is 100%
 *      deterministic, with zero fidelity loss and zero "permanent chapter drop"
 *      failure mode.
 *
 * Design notes:
 *   - Chapter numbers are SYSTEM-ASSIGNED sequential ordinals (continuing from
 *     `nextChapterNumber`), never trusted from the model. Gap-free.
 *   - Paragraphs are LOCAL to a single round (0-based, re-numbered each round).
 *     They are NEVER persisted — the body is materialised verbatim into
 *     `source_chapters.content`, and the local indices die with the round.
 *   - Carry-forward across rounds uses a sentinel, not text concatenation: if
 *     the model decides this round's first unit continues the previous
 *     chapter's storyline, it emits `endPara: -1` on the first entry, and the
 *     outliner UPDATEs the previous row in place (concat body + concat outline)
 *     instead of inserting a fresh row. See `sliceChapters` + outliner.ts.
 *   - chars-per-token calibration: the bound model's tokenizer is unknown and
 *     cannot be reliably estimated with any GPT-family tokenizer (cl100k_base
 *     over-counts Chinese by ~78% for Qwen/GLM/DeepSeek-style models). We
 *     measure the REAL ratio once up front via a small probe call
 *     (`probeCharsPerToken`), then refine it after each round by pooled
 *     accumulation (cumulative chars ÷ cumulative user-message tokens) — the
 *     maximum-likelihood estimator that converges after one round and stays
 *     converged.
 */

const logger = log.scope("Dehydrate:Chunker");

// ---------------------------------------------------------------------------
//  Tuning constants
// ---------------------------------------------------------------------------

/**
 * Token budget reserved for things we cannot measure pre-flight:
 *   - the model's internal reasoning/thinking tokens;
 *   - framework protocol wrapping (role markers, JSON envelope per message);
 *   - the tool's JSON-schema overhead (the SDK injects the `outputChapters`
 *     schema as system context, not as part of our prompt string);
 *   - the round-0 probe imprecision (the probe samples a small head of the
 *     text; the full round's density may differ slightly).
 *
 * The probe ratio is exact for the sample but only approximate for the whole
 * round; pooled accumulation corrects any bias from round 1 on.
 */
const RESERVED_BUFFER = 12_000;

/**
 * Minimum new characters per round so the loop always makes forward progress
 * even when the budget is very tight. Accepting a slight overrun here is better
 * than stalling.
 */
const MIN_NEW_CHARS = 2000;

/**
 * Target fraction of the model's context window to use for the WHOLE request
 * (excerpt + all overheads), as a guard against attention dilution. Research on
 * lost-in-the-middle (Liu et al. 2023) shows attention degradation is mild
 * below ~50% context utilization and accelerates above ~70%. Empirically, at
 * ~93% utilization round 0 failed ~50% of the time by emitting prose instead of
 * calling the tool.
 *
 * planChunk applies this as a SECOND ceiling alongside the overflow ceiling
 * (maxContext − maxOutput − reserved) and takes the lower of the two. The
 * overflow ceiling prevents overflow; the dilution ceiling keeps the request
 * inside the mild-dilution regime. On small-context models (e.g. 32k) the
 * overheads naturally eat most of the 50% target and MIN_NEW_CHARS forces the
 * excerpt above the fraction when necessary — small contexts have no room to
 * be conservative.
 *
 * Tunable: observe round-0 failure rate, adjust. 0.5 is research-informed but
 * conservative; push to 0.6 to reclaim efficiency if failures drop to ~0.
 */
const TARGET_CONTEXT_UTILIZATION = 0.5;

/**
 * Number of characters of raw text to send in the probe call. Enough to give
 * the model's tokenizer a representative sample of the content's density (it
 * covers several paragraphs of typical Chinese web-novel prose); small enough
 * to keep the probe cost negligible (~1k tokens).
 */
const PROBE_SAMPLE_CHARS = 4000;

/**
 * Conservative fallback chars-per-token used when the probe call fails (network
 * error, rate limit, etc.). Chinese-optimised models typically land around
 * 0.5-0.8 chars/token; 0.5 sizes round 0 small, guaranteeing no overflow.
 * Pooled accumulation replaces it after round 0.
 */
const FALLBACK_CHARS_PER_TOKEN = 0.5;

// ---------------------------------------------------------------------------
//  chars-per-token calibration
// ---------------------------------------------------------------------------

/**
 * Measure the model's REAL chars-per-token for the novel's content via a single
 * minimal probe call. Sends a small raw-text excerpt (untagged, no system
 * prompt, no tools) and reads back `usage.inputTokens`; the ratio
 * `excerptChars / inputTokens` is the content's true density under the model's
 * tokenizer.
 *
 * Used ONLY before round 0: it seeds `charsPerToken` so round 0 sizes against
 * the real tokenizer instead of a GPT-family guess. After round 0 the pooled
 * accumulator (`outliner.ts`) refines it.
 *
 * Returns `null` on any failure (network error, missing usage, zero tokens).
 * The caller falls back to `FALLBACK_CHARS_PER_TOKEN` so round 0 still sizes
 * small and safe.
 */
export async function probeCharsPerToken(
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
        functionId: "entertainment-outliner-probe",
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
//  Types
// ---------------------------------------------------------------------------

/**
 * The model's per-unit output: a paragraph-index reference + outline metadata.
 *
 * The model emits ONE entry per storyline unit it can fully identify in the
 * excerpt (it can see the unit's LAST paragraph). For each unit it provides:
 *   - `title`: see `ChapterEntry.title` below;
 *   - `endPara`: the LOCAL 0-based index (within the tagged `¶N¶` paragraphs of
 *     the new-text section) of the unit's LAST paragraph. The slicer takes the
 *     body as all paragraphs from the previous unit's end + 1 through `endPara`;
 *   - `outline`, `foreshadowing`: same as before.
 *
 * THE MERGE SENTINEL: when this round's first unit CONTINUES the previous
 * chapter's storyline (a cross-chapter storyline cut at the chunk boundary),
 * the model emits the FIRST entry with `endPara === -1`. On `-1` the slicer
 * flags `mergeWithCarry` and the outliner UPDATEs the previous row in place
 * (concat body + concat outline) instead of inserting a fresh row. Only valid
 * as the FIRST entry; `-1` elsewhere is a hard error.
 */
export interface ChapterEntry {
  /**
   * Title for this storyline unit — REQUIRED (never null or empty). NOT
   * required to be a verbatim heading:
   *   - single original chapter with a heading → reuse that heading verbatim;
   *   - merged unit (several original chapters) → a NEW synthesized title;
   *   - source novel with no chapter titles → also a NEW synthesized title.
   * The slicer does not validate or use this field — it passes through to the
   * `source_chapters` row untouched. The DB column is nullable for other
   * writers, but the outliner always supplies a value.
   */
  title: string;
  /**
   * The LOCAL 0-based index of this unit's LAST paragraph, counting only the
   * tagged `¶N¶` paragraphs in the new-text section (carry paragraphs are
   * untagged and NOT counted — `endPara` is always relative to the new text).
   * The slicer extracts the body as `paragraphs[prevEnd+1 .. endPara]`.
   *
   * SPECIAL VALUE `-1` (merge sentinel): emit ONLY as the FIRST entry when
   * this round's first unit continues the previous chapter's storyline. The
   * slicer then flags `mergeWithCarry`; the outliner UPDATEs the previous row
   * in place. The model MUST still supply `title`/`outline`/`foreshadowing`
   * for the merged unit.
   */
  endPara: number;
  outline: string;
  foreshadowing: string[];
}

/** The result of slicing one chapter: system-assigned number + verbatim body. */
export interface SlicedChapter {
  /** System-assigned sequential number (continuing from nextChapterNumber). */
  chapterNumber: number;
  /** Pass-through title from `ChapterEntry.title` (always present from the outliner). */
  title: string;
  /**
   * Verbatim body sliced from the untagged paragraphs array — begins at the
   * first paragraph of this unit and ends at the paragraph indexed by
   * `endPara`. Paragraphs are rejoined by `\n` (the same separator used to
   * split them out of the rawText window). The heading line, if any, is part
   * of the body or excluded depending on whether the model counts it as a
   * paragraph — there is no special heading-exclusion step here.
   */
  body: string;
  outline: string;
  foreshadowing: string[];
}

/** Result of slicing a round's entries against the paragraphs array. */
export interface SliceResult {
  /** Chapters committed this round, in order. EXCLUDES the merge-sentinel
   *  entry itself — when `mergeWithCarry` is true, the merging entry's body
   *  appears as `committed[0]` so the caller can concat it onto the carried
   *  row; subsequent entries follow normally. */
  committed: SlicedChapter[];
  /**
   * endPara of the last committed chapter (local index into the NEW
   * paragraphs only). The caller translates this to a rawText char offset
   * via `charOffsetAfterParagraph`. `-1` when nothing committed (the round
   * produced no usable body — caller treats this as a failure).
   */
  lastEndPara: number;
  /**
   * True iff the first entry was the merge sentinel (`endPara === -1`). The
   * caller uses this to decide update-in-place (merge into carried row) vs
   * fresh-insert for `committed[0]`. False on a no-carry round.
   */
  mergeWithCarry: boolean;
}

// ---------------------------------------------------------------------------
//  Chunk planning (input-budget driven, all-char math)
// ---------------------------------------------------------------------------

/**
 * Plan one round's read window `[readStart, readEnd)` into rawText.
 *
 * The excerpt budget is derived from TWO ceilings, and we take the lower:
 *
 *   1. OVERFLOW CEILING — what the context window can actually hold:
 *
 *        overflowCharBudget = (maxContext − maxOutputTokens − RESERVED_BUFFER)
 *                              × charsPerToken
 *
 *      Prevents the round from sending more tokens than the model can accept.
 *      The chars-per-token calibration (probe + pooled accumulation) keeps this
 *      accurate; it would otherwise be the only ceiling.
 *
 *   2. DILUTION CEILING — what keeps the request inside the mild-dilution
 *      regime (Liu et al. 2023, lost-in-the-middle):
 *
 *        dilutionCharBudget = maxContext × TARGET_CONTEXT_UTILIZATION
 *                              × charsPerToken
 *
 *      Attention quality degrades mildly below ~50% context utilization and
 *      accelerates above ~70%. Empirically at ~93% utilization round 0 failed
 *      ~50% of the time by emitting prose instead of calling the tool. This
 *      ceiling keeps the WHOLE request (excerpt + all overheads) at or below
 *      TARGET_CONTEXT_UTILIZATION of the window, independent of how big the
 *      window is. Scales automatically across 1M / 128k / 32k models.
 *
 * The excerpt budget is then the lower ceiling minus every fixed overhead
 * (system prompt, tool description, prior outline, carry section) — all in
 * chars, single pool:
 *
 *   excerptCharBudget = min(overflowCharBudget, dilutionCharBudget)
 *                      − priorOutlineChars
 *                      − systemPromptChars
 *                      − toolDescriptionChars
 *                      − carryChars
 *
 * On small-context models the overheads may already exceed the dilution
 * ceiling; MIN_NEW_CHARS (the floor on excerptCharBudget) then forces forward
 * progress at the cost of slightly exceeding the target utilization. Small
 * contexts have no room to be conservative.
 *
 * Keeping every term in chars (rather than subtracting tokens then converting
 * the remainder) makes the budget math uniform and makes the tagging-overhead
 * correction in the caller obvious: the caller builds the tagged excerpt and
 * shrinks it until it fits `excerptCharBudget`, guaranteeing the ACTUAL sent
 * content fits, not a pre-tag estimate.
 *
 * NO OVERLAP. Chapter continuity between back-to-back rounds is provided by the
 * 前情衔接 section (previous chapter's outline + last N paragraphs, untagged)
 * and the `-1` merge sentinel the model may emit on its first entry. readStart
 * is therefore always consumedOffset — no backup.
 *
 * @returns `{ readStart, readEnd, excerptCharBudget }`.
 */
export function planChunk(params: {
  rawTextLen: number;
  consumedOffset: number;
  maxContext: number;
  maxOutputTokens: number;
  /** Char length of the compressed cumulative prior-outline prefix. */
  priorOutlineChars: number;
  /** Char length of the outliner system prompt. */
  systemPromptChars: number;
  /** Char length of the `outputChapters` tool description (constant for a run). */
  toolDescriptionChars: number;
  charsPerToken: number;
  /**
   * Char length of the 前情衔接 carry prefix (previous chapter's outline + last
   * N paragraphs, untagged). Deducted from the budget so new text is read less
   * to avoid overflow. 0 on the first round (no previous chapter to carry).
   */
  carryChars: number;
}): {
  readStart: number;
  readEnd: number;
  excerptCharBudget: number;
} {
  const {
    rawTextLen,
    consumedOffset,
    maxContext,
    maxOutputTokens,
    priorOutlineChars,
    systemPromptChars,
    toolDescriptionChars,
    charsPerToken,
    carryChars,
  } = params;

  // Ceiling 1: overflow prevention. How many chars the window can hold after
  // reserving output + the framework/reasoning buffer.
  const overflowCharBudget = Math.max(
    0,
    (maxContext - maxOutputTokens - RESERVED_BUFFER) * charsPerToken,
  );

  // Ceiling 2: dilution prevention. Cap the WHOLE request at
  // TARGET_CONTEXT_UTILIZATION of the window so attention quality stays in the
  // mild-degradation regime. Scales with the model's context size.
  const dilutionCharBudget = Math.max(
    0,
    maxContext * TARGET_CONTEXT_UTILIZATION * charsPerToken,
  );

  // Take the lower ceiling, then subtract every fixed overhead (all in chars).
  const excerptCharBudget = Math.max(
    MIN_NEW_CHARS,
    Math.floor(
      Math.min(overflowCharBudget, dilutionCharBudget) -
        priorOutlineChars -
        systemPromptChars -
        toolDescriptionChars -
        carryChars,
    ),
  );

  const readStart = Math.max(0, consumedOffset);
  const readEnd = Math.min(rawTextLen, readStart + excerptCharBudget);
  return { readStart, readEnd, excerptCharBudget };
}

// ---------------------------------------------------------------------------
//  Paragraph-index slicing (deterministic, pure array indexing)
// ---------------------------------------------------------------------------

/**
 * Slice a round's `entries` against the `paragraphs` array (the untagged
 * paragraphs sliced from this round's rawText window). Deterministic and pure:
 * takes the model's entries + the paragraphs array + a starting chapter number,
 * returns the committed chapters with verbatim bodies and the local index of
 * the last committed paragraph.
 *
 * Contract:
 *   - `paragraphs[0]` is the first NEW paragraph of this round. Carry
 *     paragraphs (the untagged 前情衔接 section) are NOT in this array — they
 *     appear only in the prompt and never participate in slicing.
 *   - Entries are processed in order. Each entry's body is
 *     `paragraphs.slice(cursor, endPara + 1).join("\n")`, where `cursor` starts
 *     at 0 and advances to `endPara + 1` after each entry.
 *   - The FIRST entry may carry `endPara === -1` (merge sentinel). On `-1`:
 *       * `mergeWithCarry` is set to true;
 *       * the entry itself produces NO body (it has no endPara);
 *       * `cursor` does NOT advance, so the next entry's body starts at
 *         paragraph 0 — that body IS the continuation text the outliner
 *         concatenates onto the carried row;
 *       * the outliner uses the next entry's body for the merge and skips it
 *         in the new-insert loop (see outliner.ts `execute`).
 *   - If `endPara` is out of range (`> paragraphs.length - 1`), it is clamped
 *     to the last paragraph.
 *   - If `endPara` goes backwards (`< cursor - 1` for a non-first entry), the
 *     entry is skipped; the next round's carry picks up the unsliced tail.
 *   - Chapter numbers are sequential from `nextChapterNumber`, system-assigned.
 *     On a merge round, `committed[0].chapterNumber` is `nextChapterNumber` but
 *     the outliner ignores it (the merge folds committed[0]'s body into the
 *     carried row at `carryChapterNumber`); new inserts start at
 *     `nextChapterNumber + 1`. On a no-merge round, `committed[0]` and up land
 *     at `nextChapterNumber, +1, +2, ...`.
 */
export function sliceChapters(params: {
  paragraphs: string[];
  entries: ChapterEntry[];
  nextChapterNumber: number;
}): SliceResult {
  const { paragraphs, entries, nextChapterNumber } = params;
  const committed: SlicedChapter[] = [];
  let cursor = 0; // local paragraph index of the next unit's first paragraph
  let chapterNumber = nextChapterNumber;
  let lastEndPara = -1;
  let mergeWithCarry = false;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const isFirst = i === 0;

    // Merge sentinel: only valid on the first entry.
    if (entry.endPara === -1) {
      if (!isFirst) {
        // Hard error: -1 anywhere but first. Skip the entry; the outliner
        // logs and the next round's carry picks up any unsliced tail.
        // (We don't throw — a single bad entry shouldn't abort the round.)
        continue;
      }
      mergeWithCarry = true;
      // Do NOT advance cursor; do NOT produce a body. The next entry's body
      // (paragraphs[0 .. k]) is the continuation text the outliner concatenates
      // onto the carried row.
      continue;
    }

    // Clamp out-of-range endPara to the last paragraph. The model over-counted
    // but we can still recover the body up to the actual end.
    const endPara = Math.min(entry.endPara, paragraphs.length - 1);

    // Backwards / non-monotonic endPara (excludes the -1 case handled above).
    // Skip the entry; the next round's carry picks up the unsliced paragraphs.
    if (endPara < cursor - 1) {
      continue;
    }

    // Clamp start to cursor (which may have advanced past endPara via clamping
    // above; if so, the slice is empty — fall through naturally).
    const start = Math.max(cursor, 0);
    const body = paragraphs.slice(start, endPara + 1).join("\n");

    committed.push({
      chapterNumber,
      title: entry.title,
      body,
      outline: entry.outline,
      foreshadowing: entry.foreshadowing,
    });
    cursor = endPara + 1;
    lastEndPara = endPara;
    chapterNumber++;
  }

  return { committed, lastEndPara, mergeWithCarry };
}

/**
 * Translate a local paragraph index back to a rawText char offset. Sums
 * `paragraphs[0..endPara].length + 1` (the `+1` accounts for the `\n` that
 * originally separated each paragraph from the next) and adds `windowCharStart`
 * (the rawText offset where `paragraphs[0]` began).
 *
 * Example: paragraphs = ["a", "bb", "ccc"], windowCharStart = 100.
 *   charOffsetAfterParagraph(paragraphs, 1, 100) = 100 + (1+1) + (2+1) = 105
 *   (paragraphs 0 and 1 cover "a\nbb\n" = 4 chars, ending at index 104; the
 *   next char — paragraph 2's first — is at index 105).
 *
 * Returns `windowCharStart` for `endPara < 0` (nothing committed, no progress).
 */
export function charOffsetAfterParagraph(
  paragraphs: string[],
  endPara: number,
  windowCharStart: number,
): number {
  if (endPara < 0) return windowCharStart;
  const upper = Math.min(endPara + 1, paragraphs.length);
  let chars = 0;
  for (let i = 0; i < upper; i++) {
    chars += paragraphs[i].length + 1; // +1 for the `\n` separator
  }
  return windowCharStart + chars;
}

/** Conservative fallback ratio for `charsPerToken` when the probe fails. */
export const PROBE_FALLBACK_CHARS_PER_TOKEN = FALLBACK_CHARS_PER_TOKEN;
