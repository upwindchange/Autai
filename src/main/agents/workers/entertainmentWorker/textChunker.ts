import { countTokens } from "gpt-tokenizer";

/**
 * Chunk-planning + anchor-slicing logic for the merged outliner.
 *
 * The outliner (`outliner.ts`) wires it to the agent + DB; `fileDecoder.ts`
 * produces the rawText that flows in here. Dependency-free apart from
 * gpt-tokenizer (cl100k_base) — no `ai` SDK, no DB, no electron-log.
 *
 * Two responsibilities:
 *   1. `planChunk` — given the model's context window, max output, fixed
 *      overheads, and how far we've already consumed, compute the next
 *      `[readStart, readEnd)` window of raw text to feed the agent. Sizing is
 *      driven by the INPUT budget (context window), NOT max output tokens:
 *      because the model emits only short text-chunk anchors (not full chapter
 *      prose), output length is no longer the bottleneck — the context window
 *      is. A generous overlap guarantees ≥1 chapter of continuity between
 *      back-to-back agent calls.
 *   2. `sliceChapters` — the deterministic first/last-text-chunk → verbatim
 *      body slicer. The model emits, per chapter it can fully see, the first
 *      and last ~40 chars of the chapter body; this function locates those two
 *      anchors in the full rawText and slices the exact bytes between them.
 *      Zero fidelity loss (the rewriter feeds `source_chapters.content`
 *      verbatim), immune to model paraphrase, and unbounded by any per-chunk
 *      output cap (a chapter's body can be larger than maxOutputTokens without
 *      truncation, since only the two short anchors travel back through the
 *      tool call).
 *
 * Design notes:
 *   - Chapter numbers are SYSTEM-ASSIGNED sequential ordinals (continuing from
 *     `nextChapterNumber`), never trusted from the model. Gap-free.
 *   - Straddler handling: a chapter whose end falls off the readEnd edge is
 *     simply not emitted this round (the model can't see its lastTextChunk, so
 *     it won't emit it). `consumedOffset` advances only to the end of the last
 *     committed chapter; the next round's overlap re-covers the deferred
 *     chapter fully. No held-chapter state machine.
 *   - Giant-chapter safeguard: if a round commits zero chapters (the single
 *     visible chapter is bigger than the whole chunk), the caller force-advances
 *     `consumedOffset` and retries; if still zero, commits the chapter truncated.
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
 * Initial estimate of average chapter length in CHARACTERS (not tokens). Used
 * only for round 1's overlap sizing (before observed throughput is available).
 * After round 1 the estimate self-tunes from observed throughput.
 */
const INITIAL_AVG_CHARS_PER_CHAPTER = 2500;

/**
 * Overlap as a multiple of the observed average chapter length. Guarantees
 * ≥1 full chapter of continuity between back-to-back agent calls. 1.5× gives
 * headroom for chapters longer than the running average.
 */
const OVERLAP_CHAPTER_MULTIPLE = 1.5;

/**
 * Cap on the overlap as a fraction of the excerpt char budget. Prevents the
 * overlap from dominating when the budget is tight (prior outline grew large).
 * At least half the excerpt is always new text.
 */
const OVERLAP_MAX_FRACTION = 0.5;

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

/** The model's per-chapter output: two text-chunk anchors + outline metadata. */
export interface ChapterEntry {
  /** Verbatim heading text (e.g. "第一章 风起"). null if no heading. */
  title: string | null;
  /**
   * First ~40 chars of the chapter BODY (after the heading line), verbatim.
   * The slicer locates this in rawText to fix the chapter's start.
   */
  firstTextChunk: string;
  /**
   * Last ~40 chars of the chapter BODY, verbatim. The slicer locates this to
   * fix the chapter's end. The model emits a chapter ONLY when it can see both
   * anchors — so a chapter straddling the chunk edge is deferred, not emitted.
   */
  lastTextChunk: string;
  outline: string;
  foreshadowing: string[];
}

/** The full result of slicing one chapter: metadata + verbatim body + offsets. */
export interface SlicedChapter {
  /** System-assigned sequential number (continuing from nextChapterNumber). */
  chapterNumber: number;
  title: string | null;
  /** Verbatim body, heading excluded. */
  body: string;
  /** rawText start offset of `body` (inclusive). */
  startOffset: number;
  /** rawText end offset of `body` (exclusive). */
  endOffset: number;
  /** Whether the body was truncated (giant-chapter safeguard path). */
  truncated: boolean;
  outline: string;
  foreshadowing: string[];
}

/** Per-entry outcome — why a chapter was or wasn't committed. */
export type SliceOutcome =
  | { kind: "committed"; chapter: SlicedChapter }
  | { kind: "skipped"; reason: "anchor-not-found" | "out-of-order"; entry: ChapterEntry };

/** Result of slicing a round's entries against the rawText. */
export interface SliceResult {
  /** Chapters committed this round, in order. */
  committed: SlicedChapter[];
  /** Entries skipped (anchor miss / out of order). Overlap recovers them. */
  skipped: SliceOutcome[];
  /**
   * New consumed offset = end of the last committed chapter (or the input
   * searchFrom if nothing committed). The caller persists this as the recovery
   * checkpoint; the next round starts at max(0, this − overlap).
   */
  newConsumedOffset: number;
  /**
   * The highest rawText offset the slicer actually touched (for the
   * giant-chapter safeguard: the caller checks whether any progress was made).
   */
  lastSeenOffset: number;
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
 *               − RESERVED_BUFFER         (reasoning + framework + divergence pad)
 *
 * Then converted to characters via the chars-per-token (cl100k_base bootstrap
 * for round 1, recalibrated from real usage from round 2 on):
 *
 *   excerptCharBudget = inputBudget × charsPerToken
 *
 * The excerpt includes the overlap region, so readStart backs up from
 * consumedOffset by `overlapChars` (≈ 1.5× the observed average chapter length,
 * capped at half the budget) so the deferred straddler from last round is
 * re-covered. The NEW text covered = readEnd − consumedOffset is always ≥
 * MIN_NEW_CHARS so the loop makes forward progress.
 *
 * @returns `{ readStart, readEnd, excerptCharBudget, overlapChars }`.
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
  avgCharsPerChapter: number;
  /**
   * Tokens consumed by carried-forward content prepended this round (the
   * unconditional DB carry-forward). Deducted from the budget so new text is
   * read less to avoid overflow. 0 on rounds with no carry.
   */
  prependTokens?: number;
  /**
   * When true, a carry is active this round — the carried content already
   * provides chapter continuity, so no additional overlap is needed (overlap
   * set to 0, readStart = consumedOffset). When false, normal overlap applies.
   */
  hasCarry?: boolean;
}): {
  readStart: number;
  readEnd: number;
  excerptCharBudget: number;
  overlapChars: number;
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
    avgCharsPerChapter,
    prependTokens = 0,
    hasCarry = false,
  } = params;

  const inputBudget = Math.max(
    0,
    maxContext -
      maxOutputTokens -
      priorOutlineTokens -
      systemPromptTokens -
      toolDescriptionTokens -
      prependTokens -
      RESERVED_BUFFER,
  );
  const excerptCharBudget = Math.max(
    MIN_NEW_CHARS,
    Math.floor(inputBudget * charsPerToken),
  );

  // Overlap: 1.5× average chapter, capped at half the budget. When a carry is
  // active, the carried content already provides continuity → no extra overlap.
  const overlapChars = hasCarry ?
    0
  : Math.min(
      Math.ceil(avgCharsPerChapter * OVERLAP_CHAPTER_MULTIPLE),
      Math.floor(excerptCharBudget * OVERLAP_MAX_FRACTION),
    );

  const readStart = Math.max(0, consumedOffset - overlapChars);
  const readEnd = Math.min(rawTextLen, readStart + excerptCharBudget);
  return { readStart, readEnd, excerptCharBudget, overlapChars };
}

/** Initial average-chars-per-chapter estimate for round 1 (before self-tuning). */
export function initialAvgCharsPerChapter(): number {
  return INITIAL_AVG_CHARS_PER_CHAPTER;
}

/**
 * Recompute the average chars-per-chapter from a round's observed throughput.
 * Returns the prior estimate if the round committed nothing (so a stuck round
 * doesn't collapse the overlap sizing). Pure, defensive.
 */
export function recomputeAvgCharsPerChapter(
  prior: number,
  charsConsumedThisRound: number,
  chaptersCommittedThisRound: number,
): number {
  if (chaptersCommittedThisRound <= 0) return prior;
  const observed = charsConsumedThisRound / chaptersCommittedThisRound;
  if (!Number.isFinite(observed) || observed <= 0) return prior;
  return observed;
}

// ---------------------------------------------------------------------------
//  Anchor matching + slicing (deterministic)
// ---------------------------------------------------------------------------

/**
 * Collapse runs of whitespace to single spaces and trim. The model copies
 * anchors "verbatim" but may normalize line breaks / collapse spaces in its own
 * rendering; matching on the collapsed form tolerates that while still pinning
 * a unique location. Both rawText excerpt and the anchor are collapsed before
 * substring search.
 */
function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Find the (collapsed) anchor within `rawText` starting at `from`, returning the
 * OFFSET IN THE ORIGINAL rawText corresponding to the match start. Returns -1
 * if not found.
 *
 * Collapsing changes string length, so we can't `indexOf` on the collapsed
 * forms and use the index directly. Instead we map the collapsed match back to
 * an original-text offset by tracking the cumulative original-length consumed
 * as we walk through whitespace runs. This keeps the returned offset exact.
 *
 * Strategy: try the full anchor first; if no match, fall back to its first 20
 * chars (a shorter anchor is less likely to be split across a normalization
 * boundary the model rendered differently, and still pins a unique-enough spot
 * when combined with the `from` lower bound).
 */
function findAnchorOffset(
  rawText: string,
  anchor: string,
  from: number,
): number {
  const candidates = [anchor, anchor.slice(0, 20)].filter(
    (s) => s.trim().length >= 5,
  );
  for (const cand of candidates) {
    const pos = indexOfWithWhitespaceTolerance(rawText, cand, from);
    if (pos >= 0) return pos;
  }
  return -1;
}

/**
 * Locate `needle` in `haystack` starting at `from`, tolerating whitespace-run
 * differences between them. Returns the offset in `haystack` of the match start,
 * or -1. Implementation: build a sliding match by scanning haystack for the
 * needle's first non-space char, then consuming both forward while their
 * whitespace-collapsed token streams agree. To keep this tractable on large
 * inputs we constrain the search to a forward window from `from`.
 */
function indexOfWithWhitespaceTolerance(
  haystack: string,
  needle: string,
  from: number,
): number {
  // Fast path: exact substring (covers the common verbatim-copy case).
  const exact = haystack.indexOf(needle, from);
  if (exact >= 0) return exact;

  // Whitespace-tolerant fallback. Normalize needle; walk haystack from `from`,
  // matching the needle's collapsed char stream against the haystack's collapsed
  // stream but tracking the ORIGINAL haystack offset of the match start.
  const normNeedle = collapseWhitespace(needle);
  if (!normNeedle) return -1;

  // We scan candidate start positions in haystack (each non-space char from
  // `from` onward) and attempt a full match from there. Bounded by the needle
  // length × a small factor to avoid pathological scans.
  const maxScan = haystack.length;
  const firstChar = normNeedle[0];
  for (let h = from; h < maxScan; h++) {
    // Skip whitespace in haystack to align token starts (collapsed view).
    const ch = haystack[h];
    if (/\s/.test(ch)) continue;
    if (ch !== firstChar) continue;
    // Try to consume normNeedle starting here against haystack's collapsed view.
    const match = tryMatch(haystack, h, normNeedle);
    if (match >= 0) return h; // match start in ORIGINAL haystack coords
  }
  return -1;
}

/**
 * From a starting position in `haystack` (original coords), consume
 * `normNeedle` (already whitespace-collapsed) char-by-char, allowing haystack
 * whitespace runs to map to single spaces. Returns the end offset (exclusive)
 * in haystack if the whole needle matched, else -1.
 */
function tryMatch(
  haystack: string,
  hStart: number,
  normNeedle: string,
): number {
  let h = hStart;
  let n = 0;
  while (n < normNeedle.length && h < haystack.length) {
    const nc = normNeedle[n];
    const hc = haystack[h];
    if (/\s/.test(nc)) {
      // Needle expects a whitespace boundary — consume one whitespace run in haystack.
      if (!/\s/.test(hc)) return -1;
      while (h < haystack.length && /\s/.test(haystack[h])) h++;
      n++;
      continue;
    }
    if (hc !== nc) return -1;
    h++;
    n++;
  }
  return n >= normNeedle.length ? h : -1;
}

/**
 * Slice a round's `entries` against the full `rawText`, committing each chapter
 * whose two anchors both locate (and are in order). Deterministic and pure: it
 * takes the model's entries + the rawText + a starting search offset, returns
 * the committed chapters with verbatim bodies and the advanced consumed offset.
 *
 * Contract:
 *   - Entries are processed in the order given. `searchFrom` advances to each
 *     committed chapter's end, so each entry is searched after the previous one.
 *   - A chapter's body = rawText.slice(firstPos, lastEnd), TRIMMED, where
 *     firstPos is the firstTextChunk match and lastEnd is the end of the
 *     lastTextChunk match. The heading line (before firstTextChunk) is excluded
 *     and lives in `title` — matching the existing source_chapters contract.
 *   - If an entry's anchors can't both be located, or it's out of order, it's
 *     skipped (recorded in `skipped`); the overlap in the next round recovers it.
 *   - Chapter numbers are sequential from `nextChapterNumber`, system-assigned.
 */
export function sliceChapters(params: {
  rawText: string;
  entries: ChapterEntry[];
  searchFrom: number;
  nextChapterNumber: number;
  /** When set (giant-chapter safeguard), commit a final truncated chapter. */
  truncateAt?: number;
}): SliceResult {
  const { rawText, entries, searchFrom, nextChapterNumber } = params;
  const committed: SlicedChapter[] = [];
  const skipped: SliceOutcome[] = [];
  let cursor = searchFrom;
  let lastSeen = searchFrom;
  let chapterNumber = nextChapterNumber;

  for (const entry of entries) {
    const firstPos = findAnchorOffset(rawText, entry.firstTextChunk, cursor);
    if (firstPos < 0) {
      skipped.push({ kind: "skipped", reason: "anchor-not-found", entry });
      continue;
    }
    // The lastTextChunk must lie at/after the end of the firstTextChunk.
    const firstChunkEnd = firstPos + entry.firstTextChunk.length;
    const lastStart = findAnchorOffset(
      rawText,
      entry.lastTextChunk,
      firstChunkEnd,
    );
    if (lastStart < 0) {
      skipped.push({ kind: "skipped", reason: "anchor-not-found", entry });
      continue;
    }
    // Compute the true end of the lastTextChunk in original coords. Because the
    // match was whitespace-tolerant, re-walk from lastStart for the chunk's
    // collapsed length to get the exact end offset.
    const lastEnd = endOfMatch(rawText, lastStart, entry.lastTextChunk);
    if (lastEnd < 0 || lastEnd <= firstPos) {
      // Out of order — last anchor precedes first anchor. Skip; don't move cursor.
      skipped.push({ kind: "skipped", reason: "out-of-order", entry });
      continue;
    }
    const body = rawText.slice(firstPos, lastEnd).trim();
    committed.push({
      chapterNumber: chapterNumber,
      title: entry.title,
      body,
      startOffset: firstPos,
      endOffset: lastEnd,
      truncated: false,
      outline: entry.outline,
      foreshadowing: entry.foreshadowing,
    });
    cursor = lastEnd;
    lastSeen = Math.max(lastSeen, lastEnd);
    chapterNumber++;
  }

  // Giant-chapter safeguard: nothing committed but we were asked to force a
  // truncated commit for the first entry whose first anchor IS visible.
  if (committed.length === 0 && params.truncateAt != null && entries.length > 0) {
    const entry = entries[0];
    const firstPos = findAnchorOffset(rawText, entry.firstTextChunk, searchFrom);
    if (firstPos >= 0) {
      const truncEnd = Math.min(rawText.length, params.truncateAt);
      const body = rawText.slice(firstPos, truncEnd).trim();
      if (body.length > 0) {
        committed.push({
          chapterNumber,
          title: entry.title,
          body,
          startOffset: firstPos,
          endOffset: truncEnd,
          truncated: true,
          outline: entry.outline,
          foreshadowing: entry.foreshadowing,
        });
        cursor = truncEnd;
        lastSeen = Math.max(lastSeen, truncEnd);
      }
    }
  }

  const newConsumedOffset = committed.length > 0 ? cursor : searchFrom;
  return {
    committed,
    skipped,
    newConsumedOffset,
    lastSeenOffset: lastSeen,
  };
}

/**
 * Return the end offset (exclusive, original coords) of the whitespace-tolerant
 * match of `anchor` starting at `start` in `rawText`. Mirrors `tryMatch`'s walk
 * but returns the end offset rather than a success flag.
 */
function endOfMatch(rawText: string, start: number, anchor: string): number {
  const norm = collapseWhitespace(anchor);
  if (!norm) return -1;
  return tryMatch(rawText, start, norm);
}
