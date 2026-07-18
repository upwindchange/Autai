import { countTokens } from "gpt-tokenizer";
import approxSearch from "approx-string-match";
import { normalizeText } from "@agents/utils";

/**
 * Chunk-planning + anchor-slicing logic for the outliner.
 *
 * The outliner (`outliner.ts`) wires it to the agent + DB; `fileDecoder.ts`
 * produces the rawText that flows in here. Dependencies: gpt-tokenizer
 * (cl100k_base, for fixed-overhead token counts + round-1 bootstrap) and
 * approx-string-match (Myers bit-vector fuzzy anchor matching). No `ai` SDK,
 * no DB, no electron-log.
 *
 * Two responsibilities:
 *   1. `planChunk` — given the model's context window, max output, fixed
 *      overheads, and how far we've already consumed, compute the next
 *      `[readStart, readEnd)` window of raw text to feed the agent. Sizing is
 *      driven by the INPUT budget (context window), NOT max output tokens:
 *      because the model emits only short text-chunk anchors (not full chapter
 *      prose), output length is no longer the bottleneck — the context window
 *      is. There is NO overlap — chapter continuity between back-to-back rounds
 *      is provided entirely by the outliner's unconditional DB carry-forward
 *      (the last source chapter's content is prepended to the next round's
 *      excerpt; `carryTokens` is deducted from the budget here).
 *   2. `sliceChapters` — anchor → body slicer. The model emits, per chapter it
 *      can fully see, the first and last ~40 chars of the chapter body; this
 *      function locates those two anchors IN THE EXCERPT (the exact text the
 *      model saw) and slices the bytes between them. Matching is EXACT-FIRST:
 *      `indexOf` (zero false-positive risk, covers the model's contracted
 *      verbatim copies), with `approx-string-match` as the fuzzy fallback
 *      (tolerates the small drift the model does introduce — typos, a
 *      dropped/inserted char, a full/half-width space its emitted anchor
 *      carries that NFKC did not canonicalise away). maxErrors is the
 *      length-proportional budget defined by `ANCHOR_ERROR_RATIO`. A miss on
 *      both paths defers the chapter (the outliner's carry-forward re-covers
 *      it next round) rather than silently slicing the wrong span.
 *
 * Design notes:
 *   - Chapter numbers are SYSTEM-ASSIGNED sequential ordinals (continuing from
 *     `nextChapterNumber`), never trusted from the model. Gap-free.
 *   - The body is sliced from the EXCERPT (the LLM's input), not from the raw
 *     DB blob — so the anchors always correspond to text the model actually
 *     saw. Faithful to what the LLM can see.
 *   - Straddler handling: a chapter whose end falls off the readEnd edge is
 *     simply not emitted this round (the model can't see its lastTextChunk, so
 *     it won't emit it). `consumedOffset` advances only to the end of the last
 *     committed chapter; the next round's UNCONDITIONAL carry-forward re-reads
 *     that chapter's content (from DB) and prepends it, so a cross-chapter
 *     storyline cut at the chunk boundary is completed naturally. No held-
 *     chapter state machine, no overlap.
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
 * Fuzzy-anchor error budget: a single anchor (firstTextChunk / lastTextChunk)
 * is allowed up to `max(1, ⌈length × ANCHOR_ERROR_RATIO⌉)` edit errors before
 * its approximate match is rejected.
 *
 * 0.15 (≈6 errors on the contracted ~40-char anchor) is calibrated against
 * real LLM inaccuracy: a couple of char typos + a missing/inserted char + a
 * leftover full/half-width space artifact that NFKC normalisation in
 * `fileDecoder` cannot catch (the anchor comes from the model, not the file,
 * so it is not normalised). Tighter (0.10 ≈ 4) starts dropping legitimately
 * recoverable chapters; much looser (0.25+) risks an anchor matching the wrong
 * chapter's body and silently slicing across chapter boundaries.
 *
 * This ratio caps `approx-string-match`'s `search` cost (O((k/w)·n)) — the
 * library further ratchets this down internally to the best match's error
 * count, so the practical budget is whatever the cleanest match needs.
 */
const ANCHOR_ERROR_RATIO = 0.15;

/**
 * Token-counting wrapper around gpt-tokenizer's cl100k_base. Centralised so the
 * tokenizer choice lives in one place.
 *
 * Used for the FIXED overheads (system prompt, tool description, prior-outline
 * prefix) — small, stable strings whose exact count barely matters — AND for
 * the round-1 raw-text chars-per-token bootstrap. From round 2 on, the raw
 * text's chars-per-token is calibrated from the model's actual reported
 * inputTokens (see `calibrateCharsPerToken`); cl100k_base only bootstraps.
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

/** The model's per-unit output: two text-chunk anchors + outline metadata. */
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
   * First ~40 chars of the chapter BODY (after the heading line), copied
   * EXACTLY from the excerpt — character for character. The slicer matches it
   * verbatim (`indexOf`) to fix the chapter's start; any deviation skips the
   * chapter this round (the next round's carry-forward recovers it).
   */
  firstTextChunk: string;
  /**
   * Last ~40 chars of the chapter BODY, copied EXACTLY from the excerpt. The
   * slicer matches it verbatim to fix the chapter's end. The model emits a
   * chapter ONLY when it can see both anchors — so a chapter straddling the
   * chunk edge is deferred, not emitted.
   */
  lastTextChunk: string;
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
   * Verbatim body sliced from the excerpt — begins with firstTextChunk and ends
   * with lastTextChunk. The heading line is excluded (it lives in `title`),
   * matching the existing source_chapters contract.
   */
  body: string;
  outline: string;
  foreshadowing: string[];
}

/** A skipped entry and why (today the only reason is a verbatim anchor miss). */
export interface SliceOutcome {
  reason: "anchor-not-found";
  entry: ChapterEntry;
}

/** Result of slicing a round's entries against the excerpt. */
export interface SliceResult {
  /** Chapters committed this round, in order. */
  committed: SlicedChapter[];
  /** Entries skipped (an anchor didn't verbatim-match). Carry-forward recovers. */
  skipped: SliceOutcome[];
  /**
   * End offset in the EXCERPT of the last committed chapter (or `searchFrom` if
   * nothing committed). The caller maps this back to a rawText consumedOffset
   * to advance the next chunk's read window — it is NOT used for body content
   * (the body comes straight from the excerpt).
   */
  newConsumedOffset: number;
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
 *               − carryTokens            (the unconditional DB carry-forward)
 *               − RESERVED_BUFFER         (reasoning + framework + divergence pad)
 *
 * Then converted to characters via the chars-per-token (cl100k_base bootstrap
 * for round 1, recalibrated from real usage from round 2 on):
 *
 *   excerptCharBudget = inputBudget × charsPerToken
 *
 * NO OVERLAP. Chapter continuity between back-to-back rounds is provided
 * entirely by the unconditional DB carry-forward (the last source chapter's
 * content is prepended to the next round's excerpt, no annotation). readStart
 * is therefore always consumedOffset — no backup. The loop guards EOF before
 * calling, so every call has a carry except the first round (carryTokens=0).
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
   * Tokens consumed by the carried-forward content prepended this round (the
   * last source chapter's content, read from DB). Deducted from the budget so
   * new text is read less to avoid overflow. 0 on the first round (no previous
   * chapter to carry).
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
//  Anchor matching (exact-first, fuzzy fallback) + slicing (verbatim)
// ---------------------------------------------------------------------------

/**
 * A located anchor: the half-open `[start, end)` span in the excerpt where the
 * anchor was matched. `end` differs from `start + anchor.length` whenever the
 * fuzzy path matched with insertions/deletions, so callers that advance a
 * cursor past the match MUST use `end`, not the anchor's own length.
 */
interface AnchorMatch {
  start: number;
  /** Exclusive end offset of the match in the excerpt. */
  end: number;
}

/**
 * Locate an anchor in the excerpt at or after `from`. Exact-first:
 *
 *   0. NORMALISE the anchor first — the excerpt is already canonical (it was
 *      normalised at file ingestion by the same `normalizeText`), but the
 *      model's emitted anchor may carry drift NFKC/whitespace canonicalisation
 *      can fix in-place: a fullwidth ASCII char (`１`→`1`), a stray double
 *      space, a trailing newline, a CRLF. Folding the anchor into the same
 *      canonical form as the excerpt lets exact `indexOf` succeed where it
 *      would otherwise have missed and fallen through to the fuzzy path. This
 *      is the cheapest fix and recovers the most anchors.
 *   1. EXACT (`indexOf`) — zero false-positive risk, O(n). The model is
 *      contracted to copy anchors character-for-character, so (post-normalise)
 *      the overwhelming majority land here and never pay for fuzzy machinery.
 *   2. FUZZY (`approx-string-match`, Myers bit-vector) — tolerates the drift
 *      normalisation CAN'T fix: an actual typo (wrong character), a dropped or
 *      inserted character, a missing word. maxErrors is the length-proportional
 *      budget defined by `ANCHOR_ERROR_RATIO`.
 *
 * All paths return the match as a `[start, end)` span (or `null` on a miss) in
 * the EXCERPT's coordinate system. The anchor is normalised for MATCHING ONLY;
 * `sliceChapters` slices the body from the excerpt (never from the anchor), so
 * body fidelity is unaffected. The returned `end` follows the MATCHED span, not
 * the anchor's declared length, so a fuzzy match with insertions/deletions
 * advances the cursor correctly. A miss returns `null` and the entry is
 * deferred (the next round's carry-forward recovers it) rather than silently
 * slicing the wrong span.
 *
 * `approxSearch` searches the WHOLE excerpt (not just from `from`) because the
 * edit-distance computation needs surrounding context; matches at `start < from`
 * are filtered out afterwards. The library ratchets its internal threshold to
 * the best match's error count, so passing `ANCHOR_ERROR_RATIO·length` as the
 * budget yields all matches at the cleanest achievable cost — we then pick the
 * earliest one at or past `from`.
 */
function locateAnchor(
  excerpt: string,
  anchor: string,
  from: number,
): AnchorMatch | null {
  const canonicalAnchor = normalizeText(anchor);

  const exactPos = excerpt.indexOf(canonicalAnchor, from);
  if (exactPos >= 0) {
    return { start: exactPos, end: exactPos + canonicalAnchor.length };
  }

  const maxErrors = Math.max(
    1,
    Math.ceil(canonicalAnchor.length * ANCHOR_ERROR_RATIO),
  );
  const matches = approxSearch(excerpt, canonicalAnchor, maxErrors);
  for (const m of matches) {
    // `search` returns matches in ascending `end` (it scans left-to-right and
    // reports match-ends as it finds them); `start` is therefore monotonic-ish
    // but not strictly, so we still take the earliest start ≥ from rather than
    // assuming the first returned match qualifies.
    if (m.start >= from) {
      return { start: m.start, end: m.end };
    }
  }
  return null;
}

/**
 * Slice a round's `entries` against the EXCERPT (the exact text the model saw),
 * committing each chapter whose two anchors both match (exact-first, fuzzy
 * fallback) in order. Deterministic and pure: takes the model's entries + the
 * excerpt + a starting search offset, returns the committed chapters with
 * verbatim bodies and the advanced consumed offset.
 *
 * Contract:
 *   - Entries are processed in the order given. The search for each entry's
 *     lastTextChunk starts at the END of its firstTextChunk MATCH (not at
 *     `firstPos + entry.firstTextChunk.length`): a fuzzy match may end before
 *     or after the anchor's declared length when it includes
 *     insertions/deletions, and the cursor must follow the matched span or the
 *     chapters overlap/gap.
 *   - A chapter's body = excerpt.slice(firstMatch.start, lastMatch.end) — it
 *     BEGINS with the firstTextChunk and ENDS with the lastTextChunk (verbatim
 *     from the excerpt, even on a fuzzy match — the body is sliced from the
 *     excerpt, never from the anchor). The heading line (before firstTextChunk)
 *     is excluded and lives in `title` — matching the source_chapters contract.
 *   - If an entry's anchors can't both be located (neither exact nor fuzzy), it
 *     is skipped (recorded in `skipped`); the next round's carry-forward
 *     recovers it.
 *   - Chapter numbers are sequential from `nextChapterNumber`, system-assigned.
 */
export function sliceChapters(params: {
  excerpt: string;
  entries: ChapterEntry[];
  searchFrom: number;
  nextChapterNumber: number;
}): SliceResult {
  const { excerpt, entries, searchFrom, nextChapterNumber } = params;
  const committed: SlicedChapter[] = [];
  const skipped: SliceOutcome[] = [];
  let cursor = searchFrom;
  let chapterNumber = nextChapterNumber;

  for (const entry of entries) {
    const first = locateAnchor(excerpt, entry.firstTextChunk, cursor);
    if (!first) {
      skipped.push({ reason: "anchor-not-found", entry });
      continue;
    }
    const last = locateAnchor(excerpt, entry.lastTextChunk, first.end);
    if (!last) {
      skipped.push({ reason: "anchor-not-found", entry });
      continue;
    }
    committed.push({
      chapterNumber,
      title: entry.title,
      body: excerpt.slice(first.start, last.end),
      outline: entry.outline,
      foreshadowing: entry.foreshadowing,
    });
    cursor = last.end;
    chapterNumber++;
  }

  const newConsumedOffset = committed.length > 0 ? cursor : searchFrom;
  return { committed, skipped, newConsumedOffset };
}
