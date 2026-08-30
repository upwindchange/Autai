import { describe, expect, test } from "vitest";
import { EntertainmentConfigSchema, type DehydrateConfig } from "@shared";
import { buildDehydrateSystemPrompt } from "../src/main/agents/workers/entertainmentWorker/shared/dehydratePrompt";

/**
 * The dehydrate system prompt's 章节并写 (crossChapter) contract: the
 * `crossChapter.strength` dial must be honored — emitted only in the `multi`
 * variant (file-pipeline merges; one chapter carries no cross-chapter
 * context) and only when the dial is on.
 */
function makeOptions(overrides?: {
  crossChapterStrength?: number;
}): DehydrateConfig["options"] {
  // Parse once with no crossChapter override so zod fills every nested
  // default (tactics, depth, language…), then patch the dial on the result.
  const base = EntertainmentConfigSchema.parse({
    mode: "dehydrate",
    novel: { type: "file", filename: "a.txt" },
    options: { basic: {}, depth: {}, language: {}, nonNovelSource: false },
  }).options;
  if (overrides?.crossChapterStrength === undefined) return base;
  return {
    ...base,
    crossChapter: {
      ...base.crossChapter,
      strength: overrides.crossChapterStrength,
    },
  };
}

describe("buildDehydrateSystemPrompt crossChapter.strength", () => {
  test("multi + strength > 0 emits the 章节并写 block", () => {
    const prompt = buildDehydrateSystemPrompt(
      makeOptions({ crossChapterStrength: 2 }),
      "multi",
    );
    expect(prompt).toContain("章节并写");
    expect(prompt).toContain("中度收紧");
  });

  test("multi + strength 0 omits the block entirely", () => {
    const prompt = buildDehydrateSystemPrompt(
      makeOptions({ crossChapterStrength: 0 }),
      "multi",
    );
    expect(prompt).not.toContain("章节并写");
  });

  test("single variant never emits the block (no cross-chapter context)", () => {
    const prompt = buildDehydrateSystemPrompt(
      makeOptions({ crossChapterStrength: 3 }),
      "single",
    );
    expect(prompt).not.toContain("章节并写");
  });
});
