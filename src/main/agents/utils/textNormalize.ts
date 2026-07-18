/**
 * Canonical text normalisation shared between file ingestion and anchor
 * matching.
 *
 * Applied in TWO places that MUST use the SAME transform, so that the model's
 * emitted anchors can be compared against the excerpt it was shown:
 *
 *   1. `fileDecoder.decodeNovelFile` — on the raw bytes after iconv decoding,
 *      BEFORE persisting the novel text to DB. Everything downstream (chunk
 *      planning, the excerpt handed to the outliner, the body that ends up in
 *      `source_chapters.content`) reads this canonicalised form.
 *   2. `textChunker.locateAnchor` — on the model's `firstTextChunk` /
 *      `lastTextChunk` BEFORE exact/fuzzy matching. The model *saw* canonical
 *      text (the excerpt was normalised at ingestion), so its verbatim copies
 *      are mostly canonical already — but the model can still introduce drift
 *      (a stray space, a trailing newline, a full-width ASCII char that NFKC
 *      folds). Running the anchor through the SAME normaliser brings it back
 *      into the excerpt's canonical form, letting exact `indexOf` succeed
 *      instead of falling through to the fuzzy path.
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
 *   5. Blank runs — cap consecutive blank lines at one (i.e. `\n\n`).
 *   6. trim — drop leading/trailing whitespace.
 *
 * The `/u` flag on every regex is required: the text is multi-byte CJK, and the
 * `u` flag makes `.` and character classes operate on code points (not UTF-16
 * code units), so `[^\S\n]` and `\n{3,}` behave correctly on surrogate pairs.
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
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}
