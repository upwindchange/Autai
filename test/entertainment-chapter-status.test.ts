import { describe, expect, test } from "vitest";
import {
  deriveChapterStatus,
  type ChapterPipeline,
  type ChapterProgress,
} from "../src/shared/entertainment";

/**
 * Minimal spine row — `deriveChapterStatus` only reads chapterNumber +
 * sourceStatus + rewriteStatus, so a hand-built object is the exact contract
 * the backend routes pass in (progress rows straight from the frontend service).
 */
function ch(
  sourceStatus: ChapterProgress["sourceStatus"],
  rewriteStatus: ChapterProgress["rewriteStatus"],
  chapterNumber = 1,
): ChapterProgress {
  return { chapterNumber, title: null, sourceStatus, rewriteStatus };
}

const pipelines = ["file", "internet", "nonNovel"] as const;

describe("deriveChapterStatus — phase mapping", () => {
  test("no rows yet (not processed) → loading, never the stop glyph", () => {
    for (const p of pipelines) {
      expect(deriveChapterStatus(ch(null, null), { pipeline: p }).phase).toBe(
        "loading",
      );
    }
  });

  test("source fetching → searching", () => {
    expect(
      deriveChapterStatus(ch("fetching", null), { pipeline: "file" }).phase,
    ).toBe("searching");
  });

  test("source fetched, rewrite not started (queued) → loading", () => {
    expect(
      deriveChapterStatus(ch("fetched", null), { pipeline: "file" }).phase,
    ).toBe("loading");
  });

  test("actively rewriting → loading", () => {
    expect(
      deriveChapterStatus(ch("fetched", "rewriting"), { pipeline: "file" })
        .phase,
    ).toBe("loading");
  });

  test("to_be_continued → streaming (readable, continuation in flight)", () => {
    expect(
      deriveChapterStatus(ch("fetched", "to_be_continued"), {
        pipeline: "file",
      }).phase,
    ).toBe("streaming");
  });

  test("rewritten → success (renderer draws no icon)", () => {
    expect(
      deriveChapterStatus(ch("fetched", "rewritten"), { pipeline: "file" })
        .phase,
    ).toBe("success");
  });

  test("source error (no rewrite row, as internet failures produce) → error", () => {
    expect(
      deriveChapterStatus(ch("error", null), { pipeline: "internet" }).phase,
    ).toBe("error");
  });

  test("rewrite error → error", () => {
    expect(
      deriveChapterStatus(ch("fetched", "error"), { pipeline: "file" }).phase,
    ).toBe("error");
  });
});

describe("deriveChapterStatus — message keys stay pipeline-scoped", () => {
  test("not-yet-processed keeps the pending copy (reader + TOC tooltip)", () => {
    expect(
      deriveChapterStatus(ch(null, null), { pipeline: "internet" }),
    ).toEqual({
      phase: "loading",
      messageKey: "reader.status.internet.pending",
    });
  });

  test("chapter number interpolates into rewriting/queued copy", () => {
    const s = deriveChapterStatus(ch("fetched", "rewriting"), {
      pipeline: "file",
    });
    expect(s.messageKey).toBe("reader.status.file.rewriting");
    expect(s.messageParams).toEqual({ n: 1 });
  });
});
