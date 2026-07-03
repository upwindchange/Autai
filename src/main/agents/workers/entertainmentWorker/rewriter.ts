import log from "electron-log/main";
import type { DehydrateConfig } from "@shared";

const logger = log.scope("Dehydrate:Rewriter");

/** Per-step stub work duration (simulates rewrite-agent latency). */
const STUB_DELAY_MS = 2500;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * STUB rewrite. The real rewrite agent will transform 原文 → 重写 prose
 * according to the dehydrate options. For now both the file and internet routes
 * share this stub: it logs the real wizard-configured options (so the e2e test
 * can confirm they flow through), then prepends a single deterministic banner
 * to the source text to mark the chapter as rewritten. The banner is kept
 * stable (no `Date.now()`/random) so the output is reproducible.
 *
 * `options` is the dehydrate options block — `{ basic, depth, customInstruction }`
 * — i.e. `DehydrateConfig["options"]`.
 */
export async function rewriteChapter(
  sourceText: string,
  options: DehydrateConfig["options"],
): Promise<string> {
  logger.info("rewrite options", {
    sourceLen: sourceText.length,
    ...options,
  });
  await delay(STUB_DELAY_MS);
  const banner =
    "> ▸ 这是重写版（stub：在原文前注入本段以标注该章节已被重写）。\n\n";
  return `${banner}${sourceText}`;
}
