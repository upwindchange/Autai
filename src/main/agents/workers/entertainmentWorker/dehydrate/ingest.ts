import { readFileSync } from "node:fs";
import jschardet from "jschardet";
import * as iconv from "iconv-lite";
import log from "electron-log/main";
import { entertainmentService } from "@/services";
import { parseChapters } from "./chapterParser";

const logger = log.scope("Dehydrate:Ingest");

/**
 * Real business logic: read a novel file's raw bytes and decode them to a
 * string, auto-detecting the encoding (jschardet) and converting via iconv-lite.
 *
 * Bytes arrive either from a native filesystem path (`fsPath`, preferred — the
 * Electron picker yields it) or as base64 (`base64`, browser fallback where no
 * path exists). This replaces the renderer's UTF-8-only `File.text()`.
 */
export function decodeNovelFile(input: {
  fsPath?: string;
  base64?: string;
}): string {
  const bytes = input.fsPath ?
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
  try {
    return iconv.decode(bytes, encoding);
  } catch (err) {
    logger.warn("iconv decode failed; falling back to utf8", { encoding, err });
    return bytes.toString("utf8");
  }
}

// Normalize jschardet aliases to iconv-lite encoding names.
function normalizeEncoding(enc: string): string {
  const e = enc.toUpperCase();
  if (e === "GB2312" || e === "GB18030") return "GBK"; // GB2312 is a GBK subset
  if (e === "ASCII" || e === "ISO-8859-1" || e === "LATIN1") return "UTF-8";
  return enc;
}

/**
 * Parse decoded novel text into chapters and bulk-insert them as `fetched`
 * source rows (file ingestion is one-time: all chapters acquired up front).
 * Returns the count. Callers guard "thread has no source rows" before calling.
 */
export function ingestNovel(threadId: string, decodedText: string): number {
  const parsed = parseChapters(decodedText);
  parsed.forEach((chapter, i) => {
    entertainmentService.insertSourceChapter({
      threadId,
      chapterNumber: i + 1,
      title: chapter.title,
      content: chapter.originalContent,
      status: "fetched",
    });
  });
  logger.info("ingested chapters from file", { threadId, count: parsed.length });
  return parsed.length;
}
