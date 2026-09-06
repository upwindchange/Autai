import { describe, expect, test } from "vitest";
import {
  EntertainmentConfigSchema,
  resolvePipelineType,
  type EntertainmentConfig,
} from "../src/shared/entertainment";

/**
 * Minimal valid dehydrate config — mirrors how the wizard constructs defaults
 * (`INITIAL_DEHYDRATE` in wizardSteps.ts): zod fills every option default, so
 * only the discriminator + novel shape + the toggles under test are set.
 */
function makeConfig(
  novelType: "file" | "internet",
  nonNovelSource: boolean,
): EntertainmentConfig {
  return EntertainmentConfigSchema.parse({
    mode: "dehydrate",
    novel:
      novelType === "file"
        ? { type: "file", filename: "a.txt" }
        : {
            type: "internet",
            title: "T",
            // nonNovelSource forces the locked "content" kind (the schema's
            // cross-field rule rejects anything else); chaptered internet
            // configs omit sourceKind to exercise the "search" backfill.
            ...(nonNovelSource ? { sourceKind: "content" as const } : {}),
            source: "https://example.com",
          },
    options: { basic: {}, depth: {}, language: {}, nonNovelSource },
  });
}

describe("resolvePipelineType", () => {
  test("null config → file (harmless default)", () => {
    expect(resolvePipelineType(null)).toBe("file");
  });

  test("non-dehydrate mode → file", () => {
    const audiobook = EntertainmentConfigSchema.parse({
      mode: "audiobook",
      novel: { type: "file", filename: "a.txt" },
      options: { basic: {}, depth: {}, language: {}, nonNovelSource: false },
    });
    expect(resolvePipelineType(audiobook)).toBe("file");
  });

  test("file + nonNovelSource: false → file", () => {
    expect(resolvePipelineType(makeConfig("file", false))).toBe("file");
  });

  test("file + nonNovelSource: true → file (multi runner → per-chapter vocab)", () => {
    expect(resolvePipelineType(makeConfig("file", true))).toBe("file");
  });

  test("internet + nonNovelSource: false → internet", () => {
    expect(resolvePipelineType(makeConfig("internet", false))).toBe("internet");
  });

  test("internet + nonNovelSource: true → nonNovel (single row → n-less vocab)", () => {
    expect(resolvePipelineType(makeConfig("internet", true))).toBe("nonNovel");
  });
});

describe("EntertainmentConfigSchema — sourceKind", () => {
  test("parse without sourceKind → default 'search' fills", () => {
    const parsed = EntertainmentConfigSchema.parse({
      mode: "dehydrate",
      novel: { type: "internet", title: "T", source: "some keywords" },
      options: { basic: {}, depth: {}, language: {}, nonNovelSource: false },
    });
    expect(parsed.novel).toMatchObject({ type: "internet", sourceKind: "search" });
  });

  test("nonNovel + sourceKind 'search' → fails at novel.sourceKind", () => {
    const parsed = EntertainmentConfigSchema.safeParse({
      mode: "dehydrate",
      novel: { type: "internet", title: "T", sourceKind: "search", source: "https://a.com" },
      options: { basic: {}, depth: {}, language: {}, nonNovelSource: true },
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(
        parsed.error.issues.some((i) => i.path.join(".") === "novel.sourceKind"),
      ).toBe(true);
    }
  });

  test("nonNovel + non-URL source → fails at novel.source", () => {
    const parsed = EntertainmentConfigSchema.safeParse({
      mode: "dehydrate",
      novel: { type: "internet", title: "T", sourceKind: "content", source: "keywords" },
      options: { basic: {}, depth: {}, language: {}, nonNovelSource: true },
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(
        parsed.error.issues.some((i) => i.path.join(".") === "novel.source"),
      ).toBe(true);
    }
  });

  test("chaptered + link kind + non-URL source → fails at novel.source", () => {
    const parsed = EntertainmentConfigSchema.safeParse({
      mode: "dehydrate",
      novel: { type: "internet", title: "T", sourceKind: "toc", source: "nope" },
      options: { basic: {}, depth: {}, language: {}, nonNovelSource: false },
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(
        parsed.error.issues.some((i) => i.path.join(".") === "novel.source"),
      ).toBe(true);
    }
  });

  test("chaptered + link kind + valid URL → parses", () => {
    const parsed = EntertainmentConfigSchema.safeParse({
      mode: "dehydrate",
      novel: { type: "internet", title: "T", sourceKind: "toc", source: "https://a.com/book" },
      options: { basic: {}, depth: {}, language: {}, nonNovelSource: false },
    });
    expect(parsed.success).toBe(true);
  });

  test("sourceKind 'content' without nonNovel → fails at novel.sourceKind", () => {
    const parsed = EntertainmentConfigSchema.safeParse({
      mode: "dehydrate",
      novel: { type: "internet", title: "T", sourceKind: "content", source: "https://a.com/post" },
      options: { basic: {}, depth: {}, language: {}, nonNovelSource: false },
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(
        parsed.error.issues.some((i) => i.path.join(".") === "novel.sourceKind"),
      ).toBe(true);
    }
  });

  test("file novels unaffected — parse ok, no sourceKind in output", () => {
    const parsed = EntertainmentConfigSchema.parse({
      mode: "dehydrate",
      novel: { type: "file", filename: "a.txt" },
      options: { basic: {}, depth: {}, language: {}, nonNovelSource: false },
    });
    expect(parsed.novel).toEqual({ type: "file", filename: "a.txt" });
  });
});
