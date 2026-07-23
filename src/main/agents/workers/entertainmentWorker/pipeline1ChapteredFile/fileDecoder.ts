import { readFileSync } from "node:fs";
import jschardet from "jschardet";
import * as iconv from "iconv-lite";
import log from "electron-log/main";
import { normalizeText } from "@agents/utils";

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
 * After decoding, the text is run through `normalizeText` (shared with the
 * outliner's anchor matcher) — NFKC + whitespace/newline canonicalisation.
 * This is the file-upload mode only — the canonicalised text is what gets
 * persisted to DB and read by the outliner, AND it is the same transform the
 * outliner applies to the model's anchors before matching, so the two sides
 * stay in the same canonical form. See `utils/textNormalize.ts` for the full
 * rationale.
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
  return normalizeText(decoded);
}

// Normalize jschardet aliases to iconv-lite encoding names.
function normalizeEncoding(enc: string): string {
  const e = enc.toUpperCase();
  if (e === "GB2312" || e === "GB18030") return "GBK"; // GB2312 is a GBK subset
  if (e === "ASCII" || e === "ISO-8859-1" || e === "LATIN1") return "UTF-8";
  return enc;
}
