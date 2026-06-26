import log from "electron-log/main";

const logger = log.scope("Dehydrate:ChapterParser");

/**
 * Novel chapter-heading locator.
 *
 * Splits a raw novel's text into chapters by recognizing chapter headings, then
 * slicing the body of each (from its heading to the next). Adapted from the
 * legacy browser `NovelParser` regex, with the rules agreed for dehydrate
 * ingestion:
 *
 *   1. NO line anchors (`^`/`$`) — some authors place headings mid-line.
 *   2. ALL three heading shapes are run (the original stopped at the first hit).
 *   3. `chapterNumber` is the ORDINAL position in the document, never the parsed
 *      textual number. The parsed number is used only as a weak false-positive
 *      filter: a match is dropped when its number regresses by more than 1 vs the
 *      last accepted one (this is what lets us drop anchors — a mid-body `第3章`
 *      reference appearing after chapter 50 is rejected). Missing chapters
 *      (forward gaps) and ±1 typos are tolerated; a chapter is never skipped for a
 *      typoed number.
 *   4. Titles are capped (~40 chars) and the text is CRLF-normalized first. Every
 *      match is inherently a single-line headline because the character classes
 *      exclude newlines.
 *
 * This is intentionally heuristic and lenient — perfect accuracy on messy
 * web-novel sources isn't the goal; the downstream dehydrate step cleans prose.
 */
export interface ParsedChapter {
  /** Trimmed heading title, or null when the heading has no title text. */
  title: string | null;
  /** Raw chapter body (heading … next heading), unmodified. */
  originalContent: string;
}

// --- character-class building blocks --------------------------------------

// CJK + ASCII punctuation/symbols allowed inside a title. Each entry is a literal
// member of the `[...]` class below (no `|` alternation — inside a class that
// would be a literal pipe). Deliberately excludes whitespace and newlines so a
// match never spans lines.
const TITLE_CHARS =
  "。、，；：？！" + // 。、，；：？！
  "“”‘’" + // “”‘’
  "（）《》〈〉【】『』「」" + // （）《》〈〉【】『』「」
  "﹃﹄〔〕…—～﹏￥" + // … — ～ ￣ ￥ + presentation forms
  "一-龥a-zA-Z0-9"; // CJK ideographs + ASCII alphanumerics

const TITLE_CLASS = `[${TITLE_CHARS}]`;
const TITLE_OPT = `${TITLE_CLASS}{0,40}`; // 第N章 / #N# may have no title
const TITLE_REQ = `${TITLE_CLASS}{1,40}`; // bare-number needs ≥1 title char

// Chinese + Arabic numerals, and Arabic-only.
const NUMBERS = "[一二三四五六七八九十百千零两0-9]+";
const MATH_NUMS = "[0-9]+";

interface HeadingPattern {
  /** Lower = more specific; preferred when two patterns overlap the same text. */
  rank: number;
  source: string;
}

// The three heading shapes, no anchors. Capture groups: (numberText, title).
const PATTERNS: HeadingPattern[] = [
  { rank: 0, source: `第(${NUMBERS})章[ \\u3000]*(${TITLE_OPT})` },
  { rank: 1, source: `#+(${NUMBERS})(${TITLE_OPT})#+` },
  { rank: 2, source: `(${MATH_NUMS})[.、 \\u3000]*(${TITLE_REQ})` },
];

interface RawMatch {
  start: number;
  end: number;
  numberText: string;
  title: string;
  rank: number;
}

// --- Chinese-numeral → int (1..9999) --------------------------------------

const CN_DIGITS: Record<string, number> = {
  零: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};
const CN_UNITS: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };

/** Parse a chapter-number token to an int, or null if it carries no usable number. */
function toChapterNumber(raw: string): number | null {
  if (!raw) return null;
  if (/^[0-9]+$/.test(raw)) {
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  }
  let result = 0;
  let current = 0;
  for (const ch of raw) {
    if (ch in CN_DIGITS) {
      current = CN_DIGITS[ch]!;
    } else if (ch in CN_UNITS) {
      const unit = CN_UNITS[ch]!;
      // Bare 十 (no leading digit) means 1, e.g. 十=10, 十二=12.
      if (current === 0 && ch === "十") current = 1;
      result += current * unit;
      current = 0;
    } else {
      return null; // mixed/unsupported token → treat as unnumbered headline
    }
  }
  return result + current;
}

// --- main -----------------------------------------------------------------

/** Anything above this is implausible as a chapter number (likely a year/ID). */
const MAX_PLAUSIBLE_CHAPTER = 9999;

/**
 * Split `text` into chapters. Returns one entry per detected heading, in document
 * order; `chapterNumber` is assigned by the caller (ordinal position). When no
 * heading is detected, returns a single chapter covering the whole text.
 */
export function parseChapters(rawText: string): ParsedChapter[] {
  const text = rawText.replace(/\r\n?/g, "\n");

  // Collect every match from every pattern.
  const matches: RawMatch[] = [];
  for (const { rank, source } of PATTERNS) {
    const re = new RegExp(source, "g");
    for (const m of text.matchAll(re)) {
      const start = m.index;
      const numberText = m[1] ?? "";
      const title = (m[2] ?? "").trim();
      if (start === undefined) continue;
      matches.push({
        start,
        end: start + m[0].length,
        numberText,
        title,
        rank,
      });
    }
  }

  // Drop overlaps: sort by start, then specificity (rank), then longer-first;
  // greedily keep a match only if it starts at/after the last kept match's end.
  matches.sort((a, b) => a.start - b.start || a.rank - b.rank || b.end - a.end);
  const deduped: RawMatch[] = [];
  let cursor = -1;
  for (const m of matches) {
    if (m.start < cursor) continue; // overlaps a more specific / earlier heading
    deduped.push(m);
    cursor = m.end;
  }

  // Weak monotonicity filter: keep the ordinal sequence clean by rejecting gross
  // backward regressions and implausibly large numbers. Tolerate forward gaps
  // (missing chapters) and ±1 typos.
  const accepted: RawMatch[] = [];
  let lastAcceptedNum: number | null = null;
  for (const m of deduped) {
    const num = toChapterNumber(m.numberText);
    if (num !== null && num > MAX_PLAUSIBLE_CHAPTER) continue;
    if (
      num !== null &&
      lastAcceptedNum !== null &&
      num < lastAcceptedNum - 1
    ) {
      continue;
    }
    accepted.push(m);
    if (num !== null) lastAcceptedNum = num;
  }

  if (accepted.length === 0) {
    // No headings detected → treat the whole file as a single chapter.
    logger.info("no chapter headings detected; using single-chapter fallback");
    return [{ title: null, originalContent: text }];
  }

  // Slice each chapter's body from its heading to the next (last → end of text).
  const chapters: ParsedChapter[] = accepted.map((m, i) => {
    const end = accepted[i + 1]?.start ?? text.length;
    return {
      title: m.title || null,
      originalContent: text.slice(m.start, end),
    };
  });

  logger.info("parsed chapters", { count: chapters.length });
  return chapters;
}
