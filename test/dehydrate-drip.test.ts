import { describe, expect, test } from "vitest";
import { EntertainmentConfigSchema, type DehydrateConfig } from "@shared";
import {
  buildDehydrateSystemPrompt,
  buildDehydrateLeadInUserContent,
} from "../src/main/agents/workers/entertainmentWorker/shared/dehydratePrompt";

function makeOptions(): DehydrateConfig["options"] {
  // Parse once so zod fills every nested default (tactics, depth, language…).
  return EntertainmentConfigSchema.parse({
    mode: "dehydrate",
    novel: { type: "file", filename: "a.txt" },
    options: { basic: {}, depth: {}, language: {}, nonNovelSource: false },
  }).options;
}

describe("buildDehydrateSystemPrompt drip + anchor contract (multi only)", () => {
  test("multi variant announces immediate saves and the continuation anchor", () => {
    const prompt = buildDehydrateSystemPrompt(makeOptions(), "multi");
    expect(prompt).toContain("saved to the reader's library IMMEDIATELY");
    expect(prompt).toContain("Continuation anchor");
    // The bullet must name BOTH lead-in markers the loop can prepend.
    expect(prompt).toContain("【上一章续写】");
    expect(prompt).toContain("【续写锚点】");
  });
  test("multi variant carries drip pacing + minimal-thinking rules", () => {
    const prompt = buildDehydrateSystemPrompt(makeOptions(), "multi");
    expect(prompt).toContain("One tool call per message");
    expect(prompt).toContain("Thinking budget");
    expect(prompt).toContain("do not think at all");
    // The bullet must NOT frame thinking as useful work product.
    expect(prompt).not.toContain("merge plan");
  });

  test("single variant (pipeline2 rewriter) also carries the thinking budget", () => {
    const prompt = buildDehydrateSystemPrompt(makeOptions(), "single");
    expect(prompt).toContain("Thinking budget");
  });

  test("single variant omits drip pacing but keeps its own tool contract", () => {
    const prompt = buildDehydrateSystemPrompt(makeOptions(), "single");
    expect(prompt).not.toContain("saved to the reader's library IMMEDIATELY");
    expect(prompt).not.toContain("Continuation anchor");
    expect(prompt).not.toContain("【上一章续写】");
    expect(prompt).not.toContain("【续写锚点】");
    expect(prompt).not.toContain("One tool call per message");
  });
});

describe("buildDehydrateLeadInUserContent", () => {
  const content = "锚点章节正文——主角推门而入。";
  const chunk = "第一章 原文开头……";

  test("continue: replace-in-place wording, same chapter number, chunk last", () => {
    const out = buildDehydrateLeadInUserContent({
      kind: "continue",
      chapterNumber: 7,
      content,
      chunk,
    });
    expect(out).toContain("【上一章续写】");
    expect(out).toContain("使用相同的章节号 7");
    expect(out).not.toContain("章节号 8");
    expect(out).toContain(content);
    expect(out).toContain(`【本段原文】\n${chunk}`);
    // Anchor content must come BEFORE the raw-chunk section.
    expect(out.indexOf(content)).toBeLessThan(out.indexOf("【本段原文】"));
  });

  test("resume: continue-after-anchor wording, numbering N+1, anchor content first", () => {
    const out = buildDehydrateLeadInUserContent({
      kind: "resume",
      chapterNumber: 7,
      content,
      chunk,
    });
    expect(out).toContain("【续写锚点】");
    expect(out).toContain("你这一段产出的第一章使用章节号 8");
    expect(out).toContain(content);
    expect(out).toContain(`【本段原文】\n${chunk}`);
    expect(out.indexOf(content)).toBeLessThan(out.indexOf("【本段原文】"));
  });
});
