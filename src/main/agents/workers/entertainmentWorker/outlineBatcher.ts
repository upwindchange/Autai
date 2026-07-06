import { countTokens } from "gpt-tokenizer";
import type { SourceChapterRow } from "@/db/types";
import { compressPriorOutline } from "./outlineCompressor";
import log from "electron-log/main";

const logger = log.scope("Dehydrate:Outliner:Batcher");

/**
 * Token budget reserved for things `countTokens` cannot measure pre-flight:
 * the model's internal reasoning/thinking tokens, framework protocol wrapping
 * (role markers, JSON envelope per message), the tool's JSON-schema overhead
 * (the SDK injects the `outputOutlines` schema as system context, not as part
 * of our prompt string), and cl100k_base vs the actual model tokenizer
 * divergence (cl100k_base is conservative for Chinese-heavy text on most
 * non-OpenAI models, so this is mostly a safety pad).
 *
 * 12k comfortably covers light reasoning models; if the complex role is bound
 * to a heavy reasoning model (o1/DeepSeek-R1), consider raising this.
 */
const RESERVE_TOKENS = 12_000;

/**
 * Fraction of the context window the outliner is allowed to fill. The batcher
 * sizes each batch so that (system + tool-overhead + user message + output +
 * thinking) stays under `maxContext × SAFETY_FRACTION`. 0.5 leaves the other
 * half for the model's own output (one tool-call entry per chapter) and prior
 * outline growth, per the design.
 */
const SAFETY_FRACTION = 0.5;

/** A single chapter selected for one outliner batch. */
export interface BatchChapter {
  chapterNumber: number;
  content: string;
}

/** Result of planning one batch. */
export interface PlannedBatch {
  /** The chapters to feed this batch, in order. */
  chapters: BatchChapter[];
  /** Index into the source array where the next batch should start. */
  nextIndex: number;
}

/**
 * Token-counting wrapper around gpt-tokenizer's cl100k_base. Centralised so the
 * tokenizer choice lives in one place — swap here to change it everywhere.
 *
 * Note: cl100k_base is the GPT-4/4o tokenizer. For Anthropic/Google models it's
 * a close approximation (±10-20%); for Chinese-optimised domestic models
 * (Qwen/GLM) it's *conservative* — real token counts are lower, so batches come
 * out slightly smaller than they could be, which is the safe direction.
 */
function tokensOf(text: string): number {
  return countTokens(text);
}

/**
 * Stateful planner that sizes outliner batches to fit the model's context
 * window. Holds the cumulative prior-outline state so the main loop stays
 * linear and testable.
 *
 * Batching strategy: rather than estimating each chapter's token cost in
 * isolation (which misses separators, headers, and the prior-outline prefix),
 * the planner builds the *actual* user message incrementally — adding one
 * chapter at a time via `buildUserMessage` — and `tokensOf`-counts the whole
 * assembled string after each addition. This measures exactly what the model
 * will see, so the budget check is accurate with no per-chapter tax guessing.
 *
 * Lifecycle:
 *   1. `create()` — measures fixed costs (system prompt, tool description).
 *   2. `planBatch(sources, i)` — from index i, add chapters one at a time,
 *      counting the full user message each step, until the next chapter would
 *      overflow the budget. Returns the batch + next index.
 *   3. `buildUserMessage(chapters)` — assembles the user message for an
 *      arbitrary chapter list: prior-outline prefix + chapter原文.
 *   4. `absorbOutlines(newOutlines)` — after a batch's outlines land, merge
 *      them into the cumulative prior outline and compress via the simple
 *      model. The next `planBatch` sees the compressed prefix.
 *
 * Token model: gpt-tokenizer's cl100k_base, conservative for non-OpenAI models.
 */
export class OutlineBatchPlanner {
  /** Cumulative compressed prior outline (empty for the first batch). */
  private priorOutline = "";

  private constructor(
    private readonly maxContext: number,
    private readonly systemPromptTokens: number,
    private readonly toolDescriptionTokens: number,
  ) {}

  /**
   * Factory — measures the fixed token costs (system prompt, tool description)
   * before the first batch. `systemPrompt` is the outliner's system prompt
   * string; `toolDescription` is the `outputOutlines` tool's description text
   * (the SDK injects this + its JSON schema as additional system context,
   * counting against the window but outside our prompt string).
   *
   * `initialPriorOutline` seeds the cumulative prior outline — used when
   * resuming a crashed run, where earlier chapters are already `outlined` in
   * the DB and their compressed summary must be rebuilt before continuing. When
   * omitted (a fresh run from chapter 1), the prior outline starts empty.
   */
  static async create(params: {
    maxContext: number;
    systemPrompt: string;
    toolDescription: string;
    initialPriorOutline?: string;
  }): Promise<OutlineBatchPlanner> {
    const systemPromptTokens = tokensOf(params.systemPrompt);
    const toolDescriptionTokens = tokensOf(params.toolDescription);
    logger.info("planner initialized", {
      maxContext: params.maxContext,
      systemPromptTokens,
      toolDescriptionTokens,
      reserve: RESERVE_TOKENS,
      safetyFraction: SAFETY_FRACTION,
      resumed: !!params.initialPriorOutline,
    });
    const planner = new OutlineBatchPlanner(
      params.maxContext,
      systemPromptTokens,
      toolDescriptionTokens,
    );
    if (params.initialPriorOutline) {
      planner.priorOutline = params.initialPriorOutline;
    }
    return planner;
  }

  /**
   * The token budget for the user message (prior outline + chapter原文) in one
   * batch. Whatever the assembled user message `tokensOf`-counts must stay at
   * or below this for the batch to fit.
   *
   *   budget = maxContext × SAFETY_FRACTION
   *          - RESERVE_TOKENS
   *          - systemPromptTokens
   *          - toolDescriptionTokens
   *
   * The model's own output (one tool-call entry per chapter) and its thinking
   * tokens are covered by the gap between SAFETY_FRACTION × maxContext and the
   * measured input — i.e. the other ~50% of the window plus RESERVE.
   */
  private userMessageBudget(): number {
    const ceiling = this.maxContext * SAFETY_FRACTION;
    const fixed =
      RESERVE_TOKENS + this.systemPromptTokens + this.toolDescriptionTokens;
    return Math.max(0, ceiling - fixed);
  }

  /**
   * Plan one batch starting at `startIndex`. Builds the user message
   * incrementally — adding one chapter at a time and `tokensOf`-counting the
   * whole assembled string after each addition — so the measurement reflects
   * exactly what the model sees (prior prefix, separators, headers, all
   * included). Stops when the next chapter would overflow the budget. Always
   * includes at least one chapter (even if it alone overflows — better to try
   * and let the model truncate than to skip it).
   */
  planBatch(
    sources: readonly SourceChapterRow[],
    startIndex: number,
  ): PlannedBatch {
    const budget = this.userMessageBudget();
    const chapters: BatchChapter[] = [];
    let i = startIndex;
    while (i < sources.length) {
      const candidate: BatchChapter[] = [
        ...chapters,
        {
          chapterNumber: sources[i].chapterNumber,
          content: sources[i].content ?? "",
        },
      ];
      const candidateMessage = this.buildUserMessage(candidate);
      const candidateTokens = tokensOf(candidateMessage);
      // Always take at least one chapter; thereafter, stop if adding this one
      // would overflow the budget.
      if (chapters.length > 0 && candidateTokens > budget) break;
      chapters.push(candidate[candidate.length - 1]);
      i++;
    }
    logger.debug("planned batch", {
      startIndex,
      chapters: chapters.length,
      nextIndex: i,
      messageTokens: chapters.length ?
        tokensOf(this.buildUserMessage(chapters))
      : 0,
      budget,
    });
    return { chapters, nextIndex: i };
  }

  /**
   * Build the user message for a chapter list: optional prior-outline prefix
   * (the compressed cumulative summary) + the chapters'原文, separated by
   * chapter headers. This is the exact string fed to the model as the single
   * user message, so `tokensOf(buildUserMessage(...))` is an accurate measure
   * of the user-message input cost.
   */
  buildUserMessage(chapters: readonly BatchChapter[]): string {
    const parts: string[] = [];
    if (this.priorOutline) {
      parts.push(
        "前情大纲（之前章节的概括，作为上下文参考，本次无需为这些章节产出结果）：\n" +
          this.priorOutline,
      );
    }
    const chapterBlocks = chapters.map((ch) => {
      return `第 ${ch.chapterNumber} 章\n${ch.content}`;
    });
    parts.push(
      "本次需要产出大纲的章节原文：\n" + chapterBlocks.join("\n\n---\n\n"),
    );
    return parts.join("\n\n");
  }

  /**
   * Absorb a batch's freshly-written outlines into the cumulative prior
   * outline, then compress the whole thing via the simple model. Called after
   * each batch succeeds. On compression failure, keeps the un-compressed merge
   * (graceful degradation — the next batch just sees a longer prefix).
   *
   * `newOutlines` should be one string per chapter in the batch, already
   * prefixed with its chapter number (e.g. "第 12 章：...").
   */
  async absorbOutlines(
    threadId: string,
    newOutlines: string[],
  ): Promise<void> {
    if (newOutlines.length === 0) return;
    const merged =
      this.priorOutline.length > 0 ?
        [this.priorOutline, ...newOutlines].join("\n")
      : newOutlines.join("\n");

    const compressed = await compressPriorOutline(threadId, [merged]);
    if (compressed) {
      this.priorOutline = compressed;
    } else {
      // Degradation: keep the un-compressed merge. The next batch's budget
      // will simply be smaller (more of the window goes to the prefix).
      this.priorOutline = merged;
      logger.warn("compression failed; using un-compressed prior outline", {
        threadId,
        mergedLen: merged.length,
      });
    }
  }
}
