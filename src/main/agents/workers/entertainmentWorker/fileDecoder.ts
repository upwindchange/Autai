import { readFileSync } from "node:fs";
import jschardet from "jschardet";
import * as iconv from "iconv-lite";
import log from "electron-log/main";

const logger = log.scope("Dehydrate:FileDecoder");

/**
 * Read a novel file's raw bytes and decode them to a string, auto-detecting the
 * encoding (jschardet) and converting via iconv-lite. Not every text file is
 * UTF-8 (GBK/GB2312/GB18030 are common for Chinese-language novels), so the
 * codec is detected rather than assumed.
 *
 * Bytes arrive either from a native filesystem path (`fsPath`, preferred — the
 * Electron picker yields it) or as base64 (`base64`, browser fallback where no
 * path exists).
 *
 * After decoding, the text is run through `normalizeDecodedText` (NFKC +
 * whitespace/newline canonicalisation). This is the file-upload mode only — the
 * normalised text is what gets persisted to DB and read by the outliner, so the
 * model's verbatim anchors have a fighting chance of matching even when the
 * source file used non-canonical whitespace or CJK compatibility forms.
 */
export function decodeNovelFile(input: {
  fsPath?: string;
  base64?: string;
}): string {
  const bytes =
    input.fsPath ?
      readFileSync(input.fsPath)
    : Buffer.from(input.base64 ?? "", "base64");

  const detected = jschardet.detect(bytes)?.encoding ?? "utf8";
  const encoding = normalizeEncoding(detected);
  logger.info("decoding novel file", {
    via: input.fsPath ? "fsPath" : "base64",
    byteLen: bytes.length,
    detected,
    encoding,
  });
  let decoded: string;
  try {
    decoded = iconv.decode(bytes, encoding);
  } catch (err) {
    logger.warn("iconv decode failed; falling back to utf8", {
      encoding,
      err,
    });
    decoded = bytes.toString("utf8");
  }
  return normalizeDecodedText(decoded);
}

/**
 * Canonicalise decoded novel text for the outliner. Applied once at ingestion
 * (file-upload mode) so every downstream stage — DB blob, chunk planning, anchor
 * matching — sees the SAME representation.
 *
 *   1. NFKC — fold CJK compatibility forms + compatibility-namespace whitespace
 *      to their canonical composed forms (matters for Chinese text where
 *      copy-pasted sources often carry fullwidth Latin/digits or compatibility
 *      ideographs).
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
 */
function normalizeDecodedText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/\r\n?/gu, "\n")
    .replace(/[^\S\n]+/gu, " ")
    .replace(/ *\n */gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

// Normalize jschardet aliases to iconv-lite encoding names.
function normalizeEncoding(enc: string): string {
  const e = enc.toUpperCase();
  if (e === "GB2312" || e === "GB18030") return "GBK"; // GB2312 is a GBK subset
  if (e === "ASCII" || e === "ISO-8859-1" || e === "LATIN1") return "UTF-8";
  return enc;
}
