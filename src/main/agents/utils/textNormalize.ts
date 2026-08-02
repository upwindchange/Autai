/**
 * Canonical text normalisation applied during novel file ingestion
 * (`decodeViaWorker` in entertainmentRoutes.ts), on the raw bytes after iconv
 * decoding, BEFORE persisting the novel text to DB.
 *
 * Pipeline (order matters — each step assumes the prior one ran):
 *   1. NFKC — fold CJK compatibility forms + compatibility-namespace whitespace
 *      to canonical composed forms. Matters for Chinese text where copy-pasted
 *      sources carry fullwidth Latin/digits (`１`→`1`), ligatures (`ﬁ`→`fi`),
 *      or compatibility ideographs. The model can also re-emit these un-folded
 *      in its anchors even when the excerpt was folded.
 *   2. Newlines — collapse CRLF / lone CR to a single `\n`.
 *   3. Horizontal whitespace — collapse runs of spaces/tabs (but NOT newlines)
 *      to one space.
 *   4. Line-edge spaces — trim spaces immediately around newlines so lines are
 *      tight (kills indentation noise the model would otherwise have to copy
 *      verbatim into its anchors).
 *   5. Blank runs — collapse ALL runs of consecutive newlines to a single
 *      `\n`. Rationale: Chinese web novels write one paragraph per line, so
 *      every `\n` is a paragraph boundary. Authors routinely press enter
 *      twice (or paste from sources that inserted blank lines between
 *      paragraphs), producing `\n\n`, `\n\n\n`, etc. — all of which represent
 *      the SAME single paragraph break. Collapsing to one `\n` deduplicates
 *      that noise so paragraph-based segmentation (Design B) sees exactly one
 *      boundary per paragraph instead of two or three. This also simplifies
 *      downstream code: nothing has to handle "is this a paragraph break or
 *      just a blank line within the same paragraph?" — there are no blank
 *      lines. Verified no downstream code depends on `\n\n` in SOURCE text
 *      (every `\n\n` use in the codebase is in prompt-building string joins,
 *      which never flow through `normalizeText`).
 *   6. trim — drop leading/trailing whitespace.
 *
 * The `/u` flag on every regex is required: the text is multi-byte CJK, and the
 * `u` flag makes `.` and character classes operate on code points (not UTF-16
 * code units), so `[^\S\n]` and `\n{2,}` behave correctly on surrogate pairs.
 *
 * Length-changing transforms: NFKC can change length (ligatures expand,
 * compatibility forms collapse). For an anchor, that changes its declared
 * length — but `locateAnchor` returns the matched `[start, end)` span (sliced
 * from the excerpt), not the anchor's length, so body boundaries stay correct.
 */
export function normalizeText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/\r\n?/gu, "\n")
    .replace(/[^\S\n]+/gu, " ")
    .replace(/ *\n */gu, "\n")
    .replace(/\n{2,}/gu, "\n")
    .trim();
}
