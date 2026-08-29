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
