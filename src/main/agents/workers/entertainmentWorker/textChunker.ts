import { countTokens } from "gpt-tokenizer";

/**
 * Chunk-planning + paragraph-slicing logic for the outliner.
 *
 * The outliner (`outliner.ts`) wires it to the agent + DB; `fileDecoder.ts`
 * produces the rawText that flows in here. Dependencies: gpt-tokenizer
 * (cl100k_base, for fixed-overhead token counts + round-1 bootstrap). No fuzzy
 * matcher, no `approx-string-match` — slicing is deterministic array indexing.
 *
 * Two responsibilities:
 *   1. `planChunk` — given the model's context window, max output, fixed
 *      overheads, and how far we've already consumed, compute the next
 *      `[readStart, readEnd)` window of raw text to feed the agent. Sizing is
 *      driven by the INPUT budget (context window), NOT max output tokens:
 *      because the model emits only short paragraph-index references (not full
 *      chapter prose), output length is no longer the bottleneck — the context
 *      window is. There is NO overlap — chapter continuity between back-to-back
 *      rounds is provided by the outliner's 前情衔接 section (the previous
 *      chapter's outline + last N paragraphs, untagged, with a `-1` merge
 *      sentinel the model may emit on its first entry; see outliner.ts).
 *   2. `sliceChapters` — paragraph-index → body slicer. The model emits, per
 *      storyline unit it can fully see, the LOCAL index of the unit's LAST
 *      paragraph (counting only the tagged `¶N¶` paragraphs in the new-text
 *      section, 0-based); this function slices the verbatim body by pure array
 *      indexing into the untagged paragraphs array the outliner passes via
 *      `experimental_context`. No string matching, no anchors, no fuzzy
 *      fallback — body extraction is 100% deterministic, with zero fidelity
 *      loss and zero "permanent chapter drop" failure mode.
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
 *   - Tokenizer calibration: the bound model + the text's language are BOTH
 *     unknown up front, and cl100k_base (gpt-tokenizer) is a GPT-4/4o tokenizer
 *     that can be badly wrong for Chinese-optimised models (Qwen/GLM/DeepSeek).
 *     Rather than guess or pay for a probing API call, we let the chunk loop
 *     calibrate itself: round 1 uses a cl100k_base estimate (conservative →
 *     chunk smaller than real capacity → safe), then each round's actual
 *     `usage.inputTokens` (reported by the real model) refines a running
 *     chars-per-token average. No extra calls, self-correcting, robust.
 */

// ---------------------------------------------------------------------------
//  Tuning constants
// ---------------------------------------------------------------------------

/**
 * Token budget reserved for things `countTokens` cannot measure pre-flight:
 *   - the model's internal reasoning/thinking tokens;
 *   - framework protocol wrapping (role markers, JSON envelope per message);
 *   - the tool's JSON-schema overhead (the SDK injects the `outputChapters`
 *     schema as system context, not as part of our prompt string);
 *   - the round-1 cl100k_base error margin (round 1 sizes with cl100k_base before
 *     the real tokenizer has been calibrated — direction-agnostic pad).
 *
 * From round 2 on the real tokenizer is calibrated from actual usage, so this
 * mostly covers reasoning + framework overhead there. Round 1 is the one place
 * cl100k_base's divergence could bite, and there we don't pretend to know the
 * direction, so this is a plain safety pad.
 */
const RESERVED_BUFFER = 12_000;

/**
 * Exponential-moving-average weight for chars-per-token calibration. Each
 * successful round nudges the running estimate toward the freshly observed
 * chars/inputToken by this fraction (0–1). 0.4 is responsive enough to adapt
 * within ~3 rounds yet stable against a single noisy measurement.
 */
const CALIBRATION_EMA_WEIGHT = 0.4;

/**
 * Minimum new characters per round so the loop always makes forward progress
 * even when the budget is very tight. Accepting a slight overrun here is better
 * than stalling.
 */
const MIN_NEW_CHARS = 2000;

/**
 * Token-counting wrapper around gpt-tokenizer's cl100k_base. Centralised so the
 * tokenizer choice lives in one place.
 *
 * Used for the FIXED overheads (system prompt, tool description, prior-outline
 * prefix, carry prefix) — small, stable strings whose exact count barely
 * matters — AND for the round-1 raw-text chars-per-token bootstrap. From round
 * 2 on, the raw text's chars-per-token is calibrated from the model's actual
 * reported inputTokens (see `calibrateCharsPerToken`); cl100k_base only
 * bootstraps.
 */
export function tokensOf(text: string): number {
  return countTokens(text);
}

/**
 * Bootstrap estimate of the raw text's chars-per-token using cl100k_base.
 * Used ONLY for round 1 (before the real model's tokenizer has been observed):
 * cl100k_base is conservative for Chinese-optimised models (it tends to count
 * MORE tokens for Chinese than those models actually do → chars/token estimate
 * comes out LOWER → chunk comes out SMALLER → safe against overflow on round 1).
 * Round 2+ replaces this with `calibrateCharsPerToken` driven by real usage.
 *
 * Samples the head of the text to avoid a costly full-text count; the head is a
 * good-enough density proxy for the bootstrap (calibration corrects any bias).
 */
export function bootstrapCharsPerToken(rawText: string): number {
  if (!rawText) return 0;
  const sample = rawText.slice(0, 4000);
  const toks = tokensOf(sample);
  if (toks <= 0) return 0;
  const c = sample.length / toks;
  return Number.isFinite(c) && c > 0 ? c : 0;
}

/**
 * Refine the running chars-per-token estimate from a round's ACTUAL model
 * usage. After each successful round the outliner reads the real
 * `usage.inputTokens` the provider reported, plus the input char length we sent
 * (the excerpt + prefix), and folds `inputChars / inputTokens` into the running
 * estimate via exponential moving average.
 *
 * This is the ONLY accurate signal for the bound model's tokenizer (cl100k_base
 * bootstraps round 1 only). It self-corrects for both the model and the text's
 * language mix, and costs nothing — the round was already going to run.
 *
 * Returns the prior estimate unchanged if the new sample is unusable (zero
 * tokens, non-finite), so a failed read can't corrupt calibration.
 */
export function calibrateCharsPerToken(
  prior: number,
  inputChars: number,
  inputTokens: number,
): number {
  if (!inputTokens || inputTokens <= 0) return prior;
  const observed = inputChars / inputTokens;
  if (!Number.isFinite(observed) || observed <= 0) return prior;
  if (prior <= 0) return observed; // first real measurement replaces the bootstrap
  return prior + CALIBRATION_EMA_WEIGHT * (observed - prior);
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
//  Chunk planning (input-budget driven)
// ---------------------------------------------------------------------------

/**
 * Plan one round's read window `[readStart, readEnd)` into rawText.
 *
 * The excerpt budget is derived from the INPUT context window, NOT max output:
 *
 *   inputBudget = maxContext
 *               − maxOutputTokens        (reserved for the model's output)
 *               − priorOutlineTokens     (compressed cumulative outline prefix)
 *               − systemPromptTokens     (the outliner system prompt)
 *               − toolDescriptionTokens  (outputChapters tool schema overhead)
 *               − carryTokens            (the 前情衔接 carry prefix)
 *               − RESERVED_BUFFER         (reasoning + framework + divergence pad)
 *
 * Then converted to characters via the chars-per-token (cl100k_base bootstrap
 * for round 1, recalibrated from real usage from round 2 on):
 *
 *   excerptCharBudget = inputBudget × charsPerToken
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
  priorOutlineTokens: number;
  systemPromptTokens: number;
  toolDescriptionTokens: number;
  charsPerToken: number;
  /**
   * Tokens consumed by the 前情衔接 carry prefix (previous chapter's outline +
   * last N paragraphs, untagged). Deducted from the budget so new text is read
   * less to avoid overflow. 0 on the first round (no previous chapter to carry).
   */
  carryTokens: number;
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
    priorOutlineTokens,
    systemPromptTokens,
    toolDescriptionTokens,
    charsPerToken,
    carryTokens,
  } = params;

  const inputBudget = Math.max(
    0,
    maxContext -
      maxOutputTokens -
      priorOutlineTokens -
      systemPromptTokens -
      toolDescriptionTokens -
      carryTokens -
      RESERVED_BUFFER,
  );
  const excerptCharBudget = Math.max(
    MIN_NEW_CHARS,
    Math.floor(inputBudget * charsPerToken),
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
