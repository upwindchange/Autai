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
        : { type: "internet", title: "T", source: "https://example.com" },
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
