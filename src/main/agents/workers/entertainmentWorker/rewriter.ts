import { streamText, stepCountIs, tool } from "ai";
import { z } from "zod";
import log from "electron-log/main";
import { complexModel } from "@agents/providers";
import { hasSuccessfulToolResult, TIMEOUTS } from "@agents/utils";
import { settingsService, entertainmentService } from "@/services";
import type { DehydrateBasic, DehydrateConfig, DehydrateDepth } from "@shared";

const logger = log.scope("Dehydrate:Rewriter");

/** Terminal status the rewrite agent reports back to the scheduler. */
export type RewriteOutcome = "rewritten" | "error";

/**
 * `saveRewrittenContent` — the rewrite agent's single terminal tool. The agent
 * calls it once with the fully rewritten chapter prose; execute writes that
 * prose + the `"rewritten"` status to `rewritten_chapters(N)` in one shot.
 * `threadId` / `chapterNumber` arrive via `experimental_context` (zero-token —
 * never in the prompt). `hasSuccessfulToolResult("saveRewrittenContent")` then
 * stops the stream, so this single tool call both persists the result and
 * terminates the agent.
 */
const saveRewrittenContentTool = tool({
  description:
    "Call this with the fully rewritten chapter prose. Saves the rewritten text and marks the chapter done.",
  inputSchema: z.object({
    content: z
      .string()
      .min(1)
      .describe("The full rewritten chapter prose, prose only."),
  }),
  execute: async (input, { experimental_context }) => {
    const ctx = experimental_context as { threadId: string; chapterNumber: number };
    entertainmentService.updateRewrittenChapter(ctx.threadId, ctx.chapterNumber, {
      content: input.content,
      status: "rewritten",
    });
    logger.info("rewritten content saved", {
      threadId: ctx.threadId,
      chapterNumber: ctx.chapterNumber,
      contentLen: input.content.length,
    });
    return { saved: true };
  },
});

/**
 * Rewrite one chapter's 原文 → 重写 via a single-shot agent. Owns its own
 * `rewritten_chapters` row lifecycle end to end: marks `"rewriting"` up front
 * (inserting a fresh row or resetting a stale one), runs the agent under the
 * constructed system prompt, and the agent's terminal tool dumps the rewritten
 * prose + the `"rewritten"` status directly to the DB. On hard failure
 * (timeout/abort/network) or step exhaustion without a save, the row is marked
 * `"error"`. Returns the terminal status so the scheduler can branch without
 * touching the DB itself.
 *
 * The source text is re-read here (not passed in): on the internet path phase
 * 2's tool just wrote it during fetch, so the scheduler's in-memory copy would
 * be stale.
 */
export async function rewriteChapter(
  threadId: string,
  chapterNumber: number,
  options: DehydrateConfig["options"],
  signal?: AbortSignal,
): Promise<RewriteOutcome> {
  // Own the rewrite-row lifecycle: mark in-progress (insert fresh or reset stale).
  const existing = entertainmentService.getRewrittenChapter(threadId, chapterNumber);
  if (!existing) {
    entertainmentService.insertRewrittenChapter({
      threadId,
      chapterNumber,
      status: "rewriting",
    });
  } else {
    entertainmentService.updateRewrittenChapter(threadId, chapterNumber, {
      status: "rewriting",
    });
  }

  const sourceText =
    entertainmentService.getSourceChapter(threadId, chapterNumber)?.content ?? "";

  logger.info("rewriting", { threadId, chapterNumber, sourceLen: sourceText.length });

  try {
    const result = streamText({
      model: complexModel(),
      system: buildRewriteSystemPrompt(options),
      messages: [{ role: "user", content: sourceText }],
      tools: {
        saveRewrittenContent: saveRewrittenContentTool,
      },
      toolChoice: { type: "tool", toolName: "saveRewrittenContent" },
      stopWhen: [hasSuccessfulToolResult("saveRewrittenContent"), stepCountIs(3)],
      maxRetries: settingsService.settings.maxRetries,
      timeout: TIMEOUTS.chat,
      abortSignal: signal,
      experimental_context: { threadId, chapterNumber },
      experimental_telemetry: {
        isEnabled: settingsService.settings.langfuse.enabled,
        functionId: "entertainment-rewriter",
        metadata: { threadId, chapterNumber },
      },
    });

    const steps = await result.steps;
    const saved = steps
      .flatMap((s) => s.toolResults ?? [])
      .some(
        (tr) => tr.toolName === "saveRewrittenContent" && tr.type === "tool-result",
      );
    if (saved) {
      entertainmentService.touchThread(threadId);
      logger.info("chapter rewritten", { threadId, chapterNumber });
      return "rewritten";
    }
    // Step exhaustion without a save → terminal error.
    logger.error("rewrite ended without saving", { threadId, chapterNumber });
    entertainmentService.updateRewrittenChapter(threadId, chapterNumber, {
      status: "error",
    });
    return "error";
  } catch (err) {
    logger.error("rewrite failed", { threadId, chapterNumber, err });
    entertainmentService.updateRewrittenChapter(threadId, chapterNumber, {
      status: "error",
    });
    return "error";
  }
}

// ---------------------------------------------------------------------------
// Rewrite system-prompt builder
//
// Constructs the Chinese system prompt for the rewrite agent from the wizard
// options. Pure/deterministic (no Date/random). Built by injection: every
// enabled feature contributes its piece, disabled features are silent (no
// "don't do X" noise). Each strength aspect enumerates all three levels and
// names the chosen one, so the model has a calibrated sense of the dial and
// never wonders which strength to apply. `customInstruction` is appended only
// when non-empty. Wired into `rewriteChapter` above as the agent's system
// prompt.
// ---------------------------------------------------------------------------

const LEVEL_LABEL = { 1: "轻", 2: "中", 3: "重" } as const;

// Emission order follows the schema/locale; records are keyed by the schema
// types so a new toggle/aspect in `DehydrateBasic`/`DehydrateDepth` surfaces
// here as a missing-key error rather than silently dropping out of the prompt.
const BASIC_ORDER: (keyof DehydrateBasic)[] = [
  "grammarFix",
  "webSlangFilter",
  "preachRemoval",
];

const BASIC_RULES: Record<keyof DehydrateBasic, string> = {
  grammarFix:
    "错别字、病句、标点：修正错别字与语病；中文文本里混入的日语、英语标点一律改成中文标点；补齐单边引号、括号等残缺配对。",
  webSlangFilter:
    "烂词与反和谐：清理“倒吸一口凉气”“嘴角勾起一抹冷笑”之类被用烂的套话；还原被标点打码的字词，写出本来的写法。",
  preachRemoval:
    "说教与设定：删掉作者跳出来讲道理、解释设定、堆砌战力分析的内容，伪装成心理描写的说教一并删除，只留故事与剧情本身。",
};

const DEPTH_ORDER: (keyof DehydrateDepth)[] = [
  "dialoguePacing",
  "dehydrate",
  "sceneEnhance",
  "combatEnhance",
  "emotionEnhance",
  "literaryEnhance",
];

interface DepthAspectText {
  label: string;
  desc: string;
  levels: Record<1 | 2 | 3, string>;
}

const DEPTH_ASPECTS: Record<keyof DehydrateDepth, DepthAspectText> = {
  dialoguePacing: {
    label: "对话节奏",
    desc: "收紧对话的来回节奏，避免拖沓。",
    levels: {
      1: "只略微修剪明显多余的语气词与重复的“他说”“她说”。",
      2: "把“他说。她说。他又说。”式零碎对答收成一段干脆利落的对答，整体调整语气词。",
      3: "激进重构对话节奏与口吻，大量合并、改写，追求高速对白推进。",
    },
  },
  dehydrate: {
    label: "脱水提速",
    desc: "给注水内容脱水，砍掉冗余动作、重复描写和水字数，让剧情推进更快。",
    levels: {
      1: "只删明显重复的与明显水字数的内容，不删除内容走向和基本剧情。",
      2: "精炼水字数的剧情，保留但是显著加快内容，使描写更加精炼，显著提升阅读体验。",
      3: "完全删除有水字数特性的内容，把被删除的剧情高度精炼概括，概括越短越好。",
    },
  },
  sceneEnhance: {
    label: "场景氛围",
    desc: "增强场景与氛围的质感，补充感官、环境与空间感。",
    levels: {
      1: "只在关键场景点几笔细节。",
      2: "让“房间很暗”变成有画面感的场景。",
      3: "通篇铺浓氛围，调动多种感官细描。",
    },
  },
  combatEnhance: {
    label: "战斗与爽感",
    desc: "强化战斗与名场面的冲击力、节奏与爽感。",
    levels: {
      1: "只给关键招式加点力道。",
      2: "把流水账式的打斗写得拳拳到肉、节奏紧凑。",
      3: "全程燃点拉满，肾上腺素与画面感推到极致。",
    },
  },
  emotionEnhance: {
    label: "情绪张力",
    desc: "加深情绪与张力，处理角色的情绪显露、压抑与内心活动。",
    levels: {
      1: "只在关键情绪点稍作渲染。",
      2: "把“她很难过”写成真正扎心的句子。",
      3: "深入挖掘每一处情绪起伏，张力贯穿全章。",
    },
  },
  literaryEnhance: {
    label: "文采",
    desc: "润色文笔本身——节奏、用词、句式的流畅度。",
    levels: {
      1: "只理顺明显生硬的句子。",
      2: "把四平八稳的句子打磨得更有韵律和味道。",
      3: "通篇精修用词与句式，追求较高的文学质感。",
    },
  },
};

/**
 * Build the Chinese system prompt for the dehydrate rewrite agent from the
 * wizard options. Sections are injected in a fixed editorial order and joined
 * into one organic brief: role → core invariants → (source shape) → 基础清洗 →
 * 重写强度 → 语言与翻译 → 自定义指令 → output contract. Optional sections
 * appear only when they have something to say.
 */
export function buildRewriteSystemPrompt(
  options: DehydrateConfig["options"],
): string {
  const { basic, depth, language, nonNovelSource, customInstruction } = options;
  const sections: string[] = [];

  // Role + goal (always on) — gives the brief its voice and purpose.
  sections.push(
    "你是一名资深的中文小说重写编辑。你的任务是把给定的一章原文，重写成阅读体验显著更好的版本——同一个故事，换一种更好的讲法。",
  );

  // Core invariants (always on) — the "do not break" bottom line.
  sections.push(
    [
      "无论后续如何改写，以下底线始终不可破坏：",
      "- 剧情、人物、设定与关键信息一律保留：不增删情节、不改写事实，你改的是“怎么写”，不是“写了什么”。",
      "- 守住本章的边界与视角：不要补写前后章节的内容，不要擅自续写或收尾。",
      "- 保留对话的信息量与潜台词：只在表达层面优化，不要让人物说出原本没说过的话。",
    ].join("\n"),
  );

  // Source shape — only when the source is a segmented continuous text.
  if (nonNovelSource) {
    sections.push(
      "本章原文来自一段连续的非章节文本（如长帖、邮件往来、论坛串等）被切分而成，可能夹杂签名、时间戳、引用、混合语气等非正文痕迹；重写时请清理这些非故事内容，只保留并理顺故事本身，不要被原文的分页或断点带偏。",
    );
  }

  // 基础清洗 — one bullet per enabled toggle; all-off → section omitted.
  const basicRules = BASIC_ORDER.filter((k) => basic[k]).map(
    (k) => `- ${BASIC_RULES[k]}`,
  );
  if (basicRules.length) {
    sections.push(
      ["在动笔打磨之前，先完成这些不可妥协的基础清洗：", ...basicRules].join(
        "\n",
      ),
    );
  }

  // 重写强度 — each enabled aspect lists 轻/中/重 and names the chosen level.
  const depthBlocks = DEPTH_ORDER.filter((k) => depth[k].enabled).map((k) => {
    const a = DEPTH_ASPECTS[k];
    const lvl = depth[k].level as 1 | 2 | 3;
    return [
      `- ${a.label}（本次采用「${LEVEL_LABEL[lvl]}」度）：${a.desc}`,
      `  · 轻：${a.levels[1]}`,
      `  · 中：${a.levels[2]}`,
      `  · 重：${a.levels[3]}`,
    ].join("\n");
  });
  if (depthBlocks.length) {
    sections.push(
      [
        "清洗之后，按下方的力度打磨文笔。每项都已指明本次采用的强度——请严格按指明的力度执行，既不要自行加码，也不要打折：",
        ...depthBlocks,
      ].join("\n"),
    );
  }

  // 语言与翻译 — independent toggles; targetLanguage feeds translate & names.
  const tgt = language.targetLanguage.trim();
  const langItems: string[] = [];
  if (language.translate.enabled) {
    // The wizard requires `targetLanguage` whenever translate is on, so `tgt`
    // is guaranteed non-empty here — no empty-target fallback is needed.
    langItems.push(
      `- 翻译：按「${tgt}」把整本小说翻译过来，保留故事本身的风味。`,
    );
  }
  if (language.nameLocalization.enabled) {
    langItems.push(
      tgt ?
        `- 本地化姓名：把人名、地名改成符合「${tgt}」阅读习惯的写法，治好拗口的音译名。`
      : "- 本地化姓名：把拗口的人名、地名改成更易读好记、符合输出语言阅读习惯的写法。",
    );
  }
  if (language.dialogueSubject.enabled) {
    langItems.push(
      "- 补回对话主语：日系轻小说常在对话中省略主语、靠口癖暗示说话人，请补回明确的说话人主语，让读者始终清楚是谁在说话。",
    );
  }
  if (langItems.length) {
    sections.push(
      [
        "语言与翻译（各项彼此独立，按需开启；未涉及的部分由你自行协调）：",
        ...langItems,
      ].join("\n"),
    );
  }

  // 自定义指令 — appended verbatim only when the user filled it in.
  const ci = customInstruction.trim();
  if (ci) {
    sections.push(
      `此外，用户还提出以下额外要求，请在以上基础上、且不破坏核心底线的前提下尽量满足：\n\n${ci}`,
    );
  }

  // Output contract (always on) — closes the brief.
  sections.push(
    [
      "输出要求：直接输出重写后的本章正文——",
      "- 不要任何说明、旁注或前后缀，不要重复章节标题或原文；",
      "- 不要使用 Markdown 标题或代码块，保留合理的段落划分；",
      "- 除明确要求翻译或本地化外，输出语言与原文保持一致。",
    ].join("\n"),
  );

  return sections.join("\n\n");
}
