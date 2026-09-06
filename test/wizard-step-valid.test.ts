import { describe, expect, test } from "vitest";
import {
  INITIAL_DEHYDRATE,
  isStepValid,
} from "../src/renderer/components/entertainment/wizard/wizardSteps";
import type { EntertainmentConfig } from "@shared";

/**
 * Step-0 gating: Next must be disabled (isStepValid false) until both agent
 * roles resolve to a configured (provider, model) pair — the ModelCapabilityCard
 * reports this flag from settings + the configured-models list.
 */

describe("isStepValid step 0 (mode) — models-configured gate", () => {
  const config: EntertainmentConfig = INITIAL_DEHYDRATE;

  test("no provider/model configured → invalid (Next disabled)", () => {
    expect(isStepValid(0, config, false)).toBe(false);
  });

  test("both agent models configured → valid (Next enabled)", () => {
    expect(isStepValid(0, config, true)).toBe(true);
  });

  test("defaults to valid when the flag is unknown (non-step-0 callers)", () => {
    expect(isStepValid(0, config)).toBe(true);
  });

  test("flag only gates step 0 — later steps ignore it", () => {
    const novelConfig: EntertainmentConfig = {
      ...config,
      novel: { type: "file", filename: "a.txt" },
    };
    expect(isStepValid(1, novelConfig, false)).toBe(true);
  });
});

test("INITIAL_DEHYDRATE defaults to the file branch", () => {
  expect(INITIAL_DEHYDRATE.novel).toEqual({ type: "file", filename: "" });
});

describe("isStepValid step 1 (novel) — start chapter gate", () => {
  const base = {
    ...INITIAL_DEHYDRATE,
    novel: { type: "internet", title: "T", source: "s" },
  } as EntertainmentConfig;

  test("unset start chapter (default) → valid", () => {
    expect(base.novel).toMatchObject({ type: "internet" });
    expect(isStepValid(1, base, true)).toBe(true);
  });

  test("positive integer start chapter → valid", () => {
    const config = {
      ...base,
      novel: { ...base.novel, startChapterNumber: 42 },
    } as EntertainmentConfig;
    expect(isStepValid(1, config, true)).toBe(true);
  });

  test("NaN (non-numeric input past the number field) → invalid", () => {
    const config = {
      ...base,
      novel: { ...base.novel, startChapterNumber: Number.NaN },
    } as EntertainmentConfig;
    expect(isStepValid(1, config, true)).toBe(false);
  });

  test("zero / negative / fractional → invalid", () => {
    for (const startChapterNumber of [0, -3, 1.5]) {
      const config = {
        ...base,
        novel: { ...base.novel, startChapterNumber },
      } as EntertainmentConfig;
      expect(isStepValid(1, config, true)).toBe(false);
    }
  });
});

describe("isStepValid step 1 — sourceKind gating", () => {
  const make = (
    novel: Record<string, unknown>,
    options: Record<string, unknown> = {},
  ) =>
    ({
      ...INITIAL_DEHYDRATE,
      novel: { type: "internet", title: "T", source: "", ...novel },
      options: { ...INITIAL_DEHYDRATE.options, ...options },
    }) as EntertainmentConfig;

  test("chapter kind: URL + startChapterNumber → valid", () => {
    expect(
      isStepValid(
        1,
        make({
          sourceKind: "chapter",
          source: "https://a.com/c5",
          startChapterNumber: 5,
        }),
        true,
      ),
    ).toBe(true);
  });

  test("chapter kind without startChapterNumber → invalid (required)", () => {
    expect(
      isStepValid(
        1,
        make({ sourceKind: "chapter", source: "https://a.com/c5" }),
        true,
      ),
    ).toBe(false);
  });

  test("toc/page kinds: valid URL, no start chapter → valid", () => {
    for (const sourceKind of ["toc", "page"] as const) {
      expect(
        isStepValid(
          1,
          make({ sourceKind, source: "https://a.com/book" }),
          true,
        ),
      ).toBe(true);
    }
  });

  test("toc/page kinds: non-URL source → invalid", () => {
    for (const sourceKind of ["toc", "page"] as const) {
      expect(
        isStepValid(1, make({ sourceKind, source: "not a url" }), true),
      ).toBe(false);
    }
  });

  test("toc/page kinds: empty source → invalid", () => {
    for (const sourceKind of ["toc", "page"] as const) {
      expect(isStepValid(1, make({ sourceKind, source: "" }), true)).toBe(
        false,
      );
    }
  });

  test("search kind: empty source + title set → valid (source optional)", () => {
    expect(
      isStepValid(1, make({ sourceKind: "search", source: "" }), true),
    ).toBe(true);
  });

  test("nonNovel + content kind: URL → valid (link is the only input)", () => {
    expect(
      isStepValid(
        1,
        make({ sourceKind: "content", source: "https://a.com/post" }, { nonNovelSource: true }),
        true,
      ),
    ).toBe(true);
  });

  test("nonNovel + content kind: keywords → invalid", () => {
    expect(
      isStepValid(
        1,
        make({ sourceKind: "content", source: "keywords" }, { nonNovelSource: true }),
        true,
      ),
    ).toBe(false);
  });

  test("legacy config without sourceKind → backfills to search, valid", () => {
    expect(
      isStepValid(1, make({ sourceKind: undefined, source: "s" }), true),
    ).toBe(true);
  });
});
