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
