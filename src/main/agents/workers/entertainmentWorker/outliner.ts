import { streamText, stepCountIs, tool } from "ai";
import { z } from "zod";
import log from "electron-log/main";
import { complexModel } from "@agents/providers";
import type { LanguageModel } from "ai";
import { hasSuccessfulToolResult, TIMEOUTS } from "@agents/utils";
import { settingsService, entertainmentService } from "@/services";
import { sendAlert } from "@/utils/messageUtils";
import { i18n } from "@/i18n";
import type {
  CrossChapterCategory,
  CrossChapterDehydrate,
  CrossChapterTactics,
} from "@shared";
import { CROSS_CHAPTER_CATEGORIES } from "@shared";
import {
  planChunk,
  sliceChapters,
  bootstrapCharsPerToken,
  calibrateCharsPerToken,
  tokensOf,
  type ChapterEntry,
  type SliceResult,
} from "./textChunker";
import { compressPriorOutline } from "./outlineCompressor";

const logger = log.scope("Dehydrate:Outliner");

/**
 * The `outputChapters` tool — the outliner agent's terminal tool and the ONLY
 * way it delivers its result. ONE call, ONE pass: the model emits one entry per
 * chapter it can fully identify in the excerpt (both its first and last
 * text-chunk anchors visible), and the tool's execute runs self-contained
 * deterministic logic to slice each chapter's verbatim body out of the full
 * rawText, then writes a `source_chapters` row (title + verbatim content +
 * outline + foreshadowing + outlineStatus).
 *
 * This merges chapter-splitting (previously the regex chapterParser) into the
 * outliner in a single pass per chunk. The model contributes boundaries (the two
 * text-chunk anchors) + outline metadata; the system contributes the exact
 * verbatim body (zero fidelity loss — the rewriter feeds source_chapters.content
 * verbatim, so paraphrase/truncation by the model would corrupt it).
 *
 * `threadId` / `sliceText` / `searchFrom` / `carryChars` / `carryChapterNumber`
 * / `consumedOffset` / `nextChapterNumber` / `isLastBatch` all arrive via
 * `experimental_context` (zero-token — never in the prompt). Named as an output
 * verb so the model reads it as "this is how I hand back the chapters", not a
 * side-effect save it might skip.
 */
const OUTPUT_CHAPTERS_TOOL_DESCRIPTION =
  "The ONLY way to end your output and deliver the chapters — " +
  "call this outputChapters tool with one entry per storyline unit you can " +
  "FULLY identify in the excerpt (you can see BOTH its opening and its closing " +
  "text). For each unit, provide its title (REQUIRED — reuse the original " +
    "heading if the unit is a single titled chapter; otherwise write a NEW " +
    "concise title; never empty or null), the " +
  "first ~40 and last ~40 characters of its BODY (copied VERBATIM from the " +
  "excerpt — the system matches these EXACTLY, character for character, to " +
  "slice the source text; any deviation — a changed, dropped, or inserted " +
  "character, or a whitespace change — causes the unit to be skipped), plus " +
  "its outline and foreshadowing. " +
  "You are NOT ALLOWED to output units as plain text and stop your output; " +
  "they must go through this outputChapters tool. " +
  "Only emit a unit when you can see BOTH its firstTextChunk AND its " +
  "lastTextChunk in the excerpt — if a unit's end runs off the end of the " +
  "excerpt, DO NOT emit it (it will be covered in the next excerpt).";

/**
 * Context threaded into the tool's `execute` via `experimental_context` — kept
 * out of the prompt so it costs zero tokens. Holds everything execute needs to
 * slice verbatim bodies + write rows without touching RAM state the loop owns.
 *
 * CARRY-FORWARD: when the previous round's last chapter is carried into this
 * round (unconditional, unless EOF), `sliceText` = carryContent + newExcerpt
 * (a combined contiguous string), `searchFrom` = 0 (search from the combined
 * text's start), and `carryChars` = carryContent.length. The slicer locates
 * anchors in sliceText; execute maps the last anchor's end back to rawText
 * coordinates as `consumedOffset + (lastEndInSlice - carryChars)` to advance
 * the consumed offset correctly. On a normal (non-carry) round, sliceText =
 * rawText, searchFrom = consumedOffset, carryChars = 0 — the mapping is
 * identity (newConsumedOffset from sliceChapters IS the rawText offset).
 *
 * DEFERRED CARRY DELETE: the loop only READS the carried row's content — it
 * does NOT delete it. `carryChapterNumber` (null when no carry) names the row
 * that must be removed. `execute` deletes it at the LAST possible moment —
 * right before its first insert, and only if `sliceChapters` actually produced
 * committed rows. This way a failed round (no tool call, or execute throws
 * before the insert loop) leaves the carried row in the DB so the next round
 * can re-carry it, instead of silently dropping that chapter.
 */
interface OutputChaptersContext {
  threadId: string;
  /** The text the slicer searches (rawText, OR carryContent+newExcerpt). */
  sliceText: string;
  /** Lower bound for anchor search in sliceText (0 on a carry round). */
  searchFrom: number;
  /** Length of carried content prepended this round (0 if no carry). */
  carryChars: number;
  /**
   * The chapterNumber of the carried row to delete before inserting, or null
   * when there is no carry. The loop only READS the row; `execute` deletes it
   * right before the first successful insert so a failed round keeps it.
   */
  carryChapterNumber: number | null;
  /** The consumedOffset into rawText where new text begins (carry mapping). */
  consumedOffset: number;
  /** The next chapter number to assign (system-assigned, gap-free). */
  nextChapterNumber: number;
  /**
   * True when this round's read window reaches EOF — the last batch. The tool
   * finalizes the thread on it (sets finalChapterNumber, since the full chapter
   * count is known once the last batch's rows land). Reaches the tool via
   * experimental_context only — never the prompt.
   */
  isLastBatch: boolean;
}

/**
 * The single merged tool: split + outline in one pass. Execute slices verbatim
 * bodies via `textChunker.sliceChapters` and writes both tables.
 */
function makeOutputChaptersTool() {
  return tool({
    description: OUTPUT_CHAPTERS_TOOL_DESCRIPTION,
    inputSchema: z.object({
      chapters: z
        .array(
          z.object({
            title: z
              .string()
              .min(1)
              .describe(
                "The title for this storyline unit — REQUIRED, must never be " +
                  "empty or null. If the unit is a SINGLE original chapter whose " +
                  "source has a heading, reuse that original heading verbatim " +
                  "(e.g. '第一章 风起'). If the unit MERGES several original " +
                  "chapters into one storyline, write a NEW concise title " +
                  "summarizing the merged storyline. If the source novel " +
                  "provides no chapter titles at all, also write a NEW concise " +
                  "title. A synthesized title is always expected for merged or " +
                  "title-less units — never leave this empty.",
              ),
            firstTextChunk: z
              .string()
              .min(1)
              .describe(
                "The first ~40 characters of the chapter BODY (the text AFTER " +
                  "the heading line), copied VERBATIM from the excerpt. The " +
                  "system matches this string EXACTLY (character for character) " +
                  "to find the chapter's start — copy it precisely.",
              ),
            lastTextChunk: z
              .string()
              .min(1)
              .describe(
                "The last ~40 characters of the chapter BODY, copied VERBATIM " +
                  "from the excerpt. The system matches this string EXACTLY to " +
                  "find the chapter's end. Only emit this chapter if you can " +
                  "see its end; copy precisely.",
              ),
            outline: z
              .string()
              .min(1)
              .describe(
                "A brief factual plot summary of this unit: the main events, " +
                  "character decisions, and any status changes, in 2-5 sentences. " +
                  "Stored to the DB as a non-null TEXT column — must never be " +
                  "empty; if the unit has no plot content, still summarize what " +
                  "is there. No explanations, asides, or preambles; do not copy " +
                  "the original prose.",
              ),
            foreshadowing: z
              .array(z.string())
              .describe(
                "An array of short keyword/noun-phrase tags naming every clue, " +
                  "foreshadowing, planted hook, or promised payoff in this unit " +
                  "that matters later. Stored to the DB as a JSON string array " +
                  "(NOT NULL, defaults to '[]'); null is not accepted — if the " +
                  "unit plants none, return an empty array []. Each entry must be " +
                  "a short tag (not a full sentence).",
              ),
          }),
        )
        .min(1),
    }),
    execute: async (input, { experimental_context }) => {
      const ctx = experimental_context as OutputChaptersContext;
      const result: SliceResult = sliceChapters({
        excerpt: ctx.sliceText,
        entries: input.chapters as ChapterEntry[],
        searchFrom: ctx.searchFrom,
        nextChapterNumber: ctx.nextChapterNumber,
      });

      // Nothing committed → bail out BEFORE any DB mutation. The carried row
      // (if any) stays in the DB so the next round re-carries it. This is the
      // A2 fix: a round that fails or slices nothing must not drop the carried
      // chapter on the floor.
      if (result.committed.length === 0) {
        if (ctx.carryChapterNumber != null) {
          logger.debug("tool: nothing committed; keeping carried row", {
            threadId: ctx.threadId,
            carryChapterNumber: ctx.carryChapterNumber,
          });
        }
        return { saved: 0, newConsumedOffset: ctx.consumedOffset };
      }

      // LAST-MOMENT CARRY DELETE — only now that we are certain rows will be
      // written. Removing it earlier (loop start) would lose the chapter if the
      // round then failed; removing it later would collide with the first
      // insert on the (threadId, chapterNumber) unique index. FK cascade drops
      // any rewrite row too.
      if (ctx.carryChapterNumber != null) {
        entertainmentService.deleteSourceChapter(
          ctx.threadId,
          ctx.carryChapterNumber,
        );
      }

      let saved = 0;
      for (const ch of result.committed) {
        // Write the source row with outline data co-located (body verbatim,
        // heading excluded → in `title`). outlineStatus "outlined" = done.
        entertainmentService.insertSourceChapter({
          threadId: ctx.threadId,
          chapterNumber: ch.chapterNumber,
          title: ch.title,
          content: ch.body,
          status: "fetched",
          outline: ch.outline,
          foreshadowing: JSON.stringify(ch.foreshadowing),
          outlineStatus: "outlined",
        });
        saved++;
      }

      // Map the slicer's newConsumedOffset (in sliceText coordinates) back to
      // rawText coordinates. On a normal round (carryChars=0) this is identity.
      // On a carry round, the slicer's offset is within carryContent+newExcerpt;
      // the portion beyond carryChars maps to rawText at consumedOffset + delta.
      const sliceEnd = result.newConsumedOffset;
      const rawConsumedOffset =
        sliceEnd <= ctx.carryChars ?
          ctx.consumedOffset // ended within the carried portion — no new progress
        : ctx.consumedOffset + (sliceEnd - ctx.carryChars);
      entertainmentService.setConsumedOffset(ctx.threadId, rawConsumedOffset);

      // The last batch reaches EOF — once its rows land, the full chapter count
      // is known, so finalize the thread here (the flag arrives via context,
      // never the prompt). buildOutlines' entry guard then blocks re-entry.
      if (ctx.isLastBatch && saved > 0) {
        entertainmentService.setFinalChapterNumber(
          ctx.threadId,
          entertainmentService.maxSourceChapterNumber(ctx.threadId),
        );
      }

      if (result.skipped.length > 0) {
        logger.warn("tool: chapter entries skipped (anchors not found)", {
          threadId: ctx.threadId,
          skipped: result.skipped.length,
          reasons: result.skipped.map((s) => s.reason),
        });
      }
      logger.info("tool: chapters committed", {
        threadId: ctx.threadId,
        saved,
        skipped: result.skipped.length,
        rawConsumedOffset,
        chapters: result.committed.map((c) => c.chapterNumber),
        isLastBatch: ctx.isLastBatch,
      });
      return { saved, newConsumedOffset: rawConsumedOffset };
    },
  });
}

/**
 * Reinforcement appended to the system prompt on the one-shot retry when the
 * agent stopped without calling `outputChapters`. Mirrors the rewriter's retry.
 */
const RETRY_SUFFIX = `

## ⚠ Your previous submission was invalid — you must resubmit through the tool
Your last response did not call the outputChapters tool; \
instead, you stopped after emitting plain text. \
Plain text is not accepted, so the result is invalid. \
Please resubmit now: call the outputChapters tool with ONE entry per storyline \
unit you can FULLY identify in the excerpt (you can see BOTH its firstTextChunk \
AND its lastTextChunk). Each entry carries: title (REQUIRED — reuse the original \
heading for a single titled chapter, otherwise synthesize a NEW concise title \
for a merged or title-less unit; never empty), firstTextChunk + lastTextChunk \
(copied VERBATIM, character for character), outline (non-empty factual summary), \
and foreshadowing (string array; [] if none). Do not output plain text, and do \
not write any content outside of the tool call.`;

// ---------------------------------------------------------------------------
// Cross-chapter tactic lookup table (章节并写 rules).
//
// One entry per tactic in `CrossChapterTactics` (the 49 cross/both sub-tactics
// from situation_based_prompt.md). Each holds the tactic's Chinese label plus a
// `rule` that names the 套路 and signals what makes it a cross-chapter pattern.
// `Record<keyof CrossChapterTactics, …>` makes a new tactic in the schema
// surface here as a missing-key error. `CROSS_CHAPTER_CATEGORY_LABELS` names the
// 12 groups (the 16 content-genre categories minus the 4 that are all-single);
// grouping/order comes from `CROSS_CHAPTER_CATEGORIES` (shared). The outliner
// injects only the tactics the user enabled, as guidance for WHICH consecutive
// chapters should be merged into a single source row (the carry-forward +
// merge design replaces the former per-chapter needsCrossWrite flag).
// ---------------------------------------------------------------------------

const CROSS_CHAPTER_CATEGORY_LABELS: Record<CrossChapterCategory, string> = {
  combatCompetition: "战斗/竞技类",
  crowdReaction: "群众反应类",
  loreDump: "设定解释类",
  romanceDrag: "情感/言情类",
  villainFaceSlap: "反派/打脸类",
  dailyLife: "日常生活类",
  dialogueFiller: "对话类",
  structuralDelay: "结构性拖延类",
  thrillLoop: "爽点循环类",
  femaleAudience: "女频/关系流",
  maleAudience: "男频常见",
  sciFiApocalypse: "科幻/末世/无限流",
  workplaceIndustry: "商业/职场/娱乐圈",
  prosePadding: "形式上的",
  plotLoop: "剧情循环类",
  genreSpecific: "特殊题材专属",
};

/**
 * One entry per `keyof CrossChapterTactics`. The `rule` is the
 * situation_based_prompt.md dehydration prompt for that tactic — it names the
 * pattern and the filler-vs-core split. Here it serves as the description of a
 * cross-chapter pattern whose consecutive chapters should be MERGED into one
 * source row by the outliner. Text transcribed verbatim from
 * `situation_based_prompt.md` (section number in the comment for traceability).
 */
const CROSS_CHAPTER_TACTICS: Record<
  keyof CrossChapterTactics,
  { label: string; rule: string }
> = {
  // §1 — combatCompetition
  tournamentLoop: {
    label: "擂台赛/排位赛/大比武循环",
    rule:
      "擂台赛、排位赛、大比武、联赛、才艺比试等循环赛事。" +
      "其中无关配角的完整对场、与胜负无关的规则罗列、每场都重复的观众反应、主角迟迟不上场的过度铺垫，是水；" +
      "与主角、核心反派、重要配角或主线资源相关的场次，以及影响胜负的关键规则，才是有效信息。",
  },
  // §2
  mobGrinding: {
    label: "打小怪/杂兵/分身",
    rule:
      "连续打小怪、杂兵、丧尸、虫族、魔物、刺客等段落。" +
      "其中只换名字颜色等级的同质敌人、重复的招式和重复的收割过程，是水；" +
      "首次展示威胁、获得关键资源、暴露新能力、引出大敌或造成消耗的战斗，才是有效信息。",
  },
  // §6
  fakeDisadvantage: {
    label: "“看似逆风”的假紧张",
    rule:
      "主角明有底牌却反复被制造“看似逆风”。" +
      "其中“被压制—众人担心—反派得意—主角微笑”这一流程的反复套用，是水；" +
      "真正有风险、有代价或策略有变化的部分，以及反转本身，才是有效信息。",
  },
  // §7
  escalatingElders: {
    label: "“护短长辈”逐级登场",
    rule:
      "打了小的来老的、长老/宗主/太上长老逐级登场的套娃冲突。" +
      "其中相似层级的重复登场、重复威胁、重复报身份、重复被打脸，是水；" +
      "真正改变冲突规模、揭示势力结构或逼出主角新选择的上位者，才是有效信息。",
  },
  // §20 — romanceDrag
  misunderstandings: {
    label: "误会拉扯",
    rule:
      "误会、冷战、信息不对称。" +
      "其中“不解释”式纯靠不沟通拖剧情的反复拉扯，是水；" +
      "源自人物性格、现实阻碍或合理证据的误会，以及真正改变关系的误解、试探与选择，才是有效信息。",
  },
  // §22
  jealousyCycles: {
    label: "吃醋桥段循环",
    rule:
      "吃醋、前任、白月光、青梅竹马等桥段。" +
      "其中重复的冷脸、追问、不解释，是水；" +
      "推动关系升级或暴露人物真实需求的部分，以及每次带来新关系变化的吃醋，才是有效信息。",
  },
  // §24
  banquetFiller: {
    label: "宴会/舞会/宫宴",
    rule:
      "宴会、舞会、宫宴等社交场景。" +
      "其中入场顺序、寒暄、献艺、送礼等与主线无关的流程，是水；" +
      "核心冲突、人物试探、身份揭露和关系变化，才是有效信息。",
  },
  // §25
  familyGossip: {
    label: "家长里短/亲戚群像",
    rule:
      "婆媳、妯娌、邻里、亲戚借钱、村里闲话等家长里短。" +
      "其中重复的八卦和无效争吵，是水；" +
      "会影响主角处境、资源、名声或情感关系的冲突，才是有效信息。",
  },
  // §28 — villainFaceSlap
  braindeadVillains: {
    label: "降智反派反复送人头",
    rule:
      "反派多次不吸取教训、重复挑衅主角。" +
      "其中反派没有新策略、新资源或新威胁时的重复自信宣言与重复送人头，是水；" +
      "能提升冲突强度的新行动，以及失败后的代价，才是有效信息。",
  },
  // §30
  trialReveal: {
    label: "审判/揭穿/对质场景",
    rule:
      "审判、揭穿、对质、人证物证反转。" +
      "其中重复证词和无效争辩、被无意义打断多次的真相，是水；" +
      "“误导证据—关键反转—决定性证据”的证据链与决定性结果，才是有效信息。",
  },
  // §32 — dailyLife
  travelFiller: {
    label: "赶路/旅行",
    rule:
      "赶路、旅行、迁徙。" +
      "其中重复的路况、天气、住宿和闲聊，以及单纯从A到B的过渡，是水；" +
      "途中遭遇、地图信息、人物互动或危机伏笔，才是有效信息。",
  },
  // §33
  shoppingFiller: {
    label: "逛街/购物",
    rule:
      "逛街、购物、买衣服、买车买房等消费桥段。" +
      "其中商品列表、重复的柜员看不起，是水；" +
      "引发冲突、展示身份、改变资源或推动关系的购买行为，才是有效信息。",
  },
  // §34
  questDungeon: {
    label: "做任务/刷副本",
    rule:
      "任务、副本、支线、NPC对话。" +
      "其中弱相关的小怪、支线和无效解谜，是水；" +
      "主线相关目标、关键规则、重要选择、最终奖励，以及改变人物/资源/世界线的结果，才是有效信息。",
  },
  // §35
  trainingStudy: {
    label: "训练/学习过程",
    rule:
      "训练、学习、讲课、练习。" +
      "其中教学细节和重复失败、机械刷熟练度，是水；" +
      "主角理解难点、突破方法、能力变化和他人反应，以及体现成长的环节，才是有效信息。",
  },
  // §40 — structuralDelay
  climaxPovSwitch: {
    label: "卡高潮前切视角",
    rule:
      "高潮前切视角。" +
      "其中只为拖延主角出手、不提供关键反转/危险升级/情绪对照的新视角，是水；" +
      "真正提供新信息或多线交汇的视角切换，以及高潮本身的兑现，才是有效信息。",
  },
  // §41
  multiPovReplay: {
    label: "多视角重复同一事件",
    rule:
      "同一事件多视角重复叙述。" +
      "其中只重复震惊和回放、不提供新信息/新误解/新后果的视角，是水；" +
      "每个视角必须带来新信息，否则应合并——主视角加一句概括他人认知变化，才是有效信息。",
  },
  // §42
  flashbacks: {
    label: "回忆杀",
    rule:
      "回忆、前世、童年、旧案、往事。" +
      "其中完整流水账式回忆，是水；" +
      "只解释当前选择或冲突所需的片段，且短、准、有钩子并尽快回到现实行动的回忆，才是有效信息。",
  },
  // §43
  dreamIllusionTrial: {
    label: "梦境/幻境/试炼",
    rule:
      "梦境、幻境、心魔、轮回试炼。" +
      "其中与现实主线无关的幻境铺陈，是水；" +
      "能揭示人物恐惧、欲望、弱点或获得关键线索、且试炼结果影响现实的内容，才是有效信息。",
  },
  // §44
  secretRealm: {
    label: "秘境/遗迹探索",
    rule:
      "秘境、遗迹、洞府探索。" +
      "其中入口争夺、规则说明、小怪、草药、机关等重复环节，是水；" +
      "核心宝物、旧敌冲突、传承线索和主角选择，才是有效信息。",
  },
  // §45
  auction: {
    label: "拍卖会",
    rule:
      "拍卖会。" +
      "其中无关拍品的详写、包厢等级、拍卖师出场、竞价反应、反派抬价的重复堆叠，是水；" +
      "与主角目标、反派冲突或后续主线有关的拍品，以及导向捡漏/冲突/截杀后果的部分，才是有效信息。",
  },
  // §46
  entranceExam: {
    label: "宗门/学院/公司考核",
    rule:
      "入门考核、天赋测试、面试、实战、排名公布。" +
      "其中重复测试和无名配角表现，是水；" +
      "能区分人物能力、造成冲突或决定资源分配的环节，以及尽快落到主角处境变化的结果，才是有效信息。",
  },
  // §47 — thrillLoop
  hiddenPowerLoops: {
    label: "反复隐藏实力",
    rule:
      "主角隐藏实力被看轻再震惊全场的循环。" +
      "其中后续每次完整重演“被看轻—震惊”，是水；" +
      "最有代表性的一次铺垫和爆发，以及出现新身份风险/新敌人判断/新代价时的处理，才是有效信息。",
  },
  // §48
  identityReveals: {
    label: "反复身份揭露",
    rule:
      "马甲、身份、职业、背景逐个揭露。" +
      "其中单纯为了震惊的身份展示，是水；" +
      "每次带来新剧情后果的揭露，以及把多个次要马甲合并、篇幅集中在最重要身份冲击上的处理，才是有效信息。",
  },
  // §49
  nobodyKnowsMc: {
    label: "别人不知道主角是谁",
    rule:
      "柜员、同学、亲戚、上司、反派等不断不认识主角的桥段。" +
      "其中无关误认和重复打脸流程，是水；" +
      "对主角当前目标造成实际阻碍的人，以及快速处理的轻视，才是有效信息。",
  },
  // §52 — femaleAudience
  heiressDrama: {
    label: "真假千金家庭拉扯",
    rule:
      "真假千金、家人偏心、哥哥误会、家人后悔等桥段。" +
      "其中重复委屈和反复误会、多人物轮流水，是水；" +
      "家人态度变化的关键节点、真相证据和关系不可逆转的选择，才是有效信息。",
  },
  // §53
  evilSidekick: {
    label: "恶毒女配作妖",
    rule:
      "恶毒女配诬陷、装可怜、买水军、抢功劳等桥段。" +
      "其中重复作妖、重复哭诉和重复反杀，是水；" +
      "她的新手段和主角反制，以及每次陷害升级或暴露新信息的部分，才是有效信息。",
  },
  // §54
  ceoControlMinutiae: {
    label: "霸总日常控制细节",
    rule:
      "霸总安排司机、衣服、饮食、保镖、查行踪、买楼买店等桥段。" +
      "其中无后果的控制性日常，是水；" +
      "体现关系张力、权力冲突或人物改变的细节，以及推动关系的互动，才是有效信息。",
  },
  // §55
  cuteBabyAssist: {
    label: "带娃/萌宝助攻",
    rule:
      "萌宝卖萌、撮合、装病、天才技能打脸等桥段。" +
      "其中单纯可爱但无推进的互动，是水；" +
      "推动亲子关系、男女主关系或身份真相的内容，才是有效信息。",
  },
  // §56
  varietyLivestream: {
    label: "综艺/直播任务",
    rule:
      "综艺、直播、嘉宾任务。" +
      "其中重复弹幕、游戏流程和嘉宾闲聊、无限拆分的一期节目，是水；" +
      "任务规则、人物冲突、表现反差和舆论后果，以及清晰的情绪曲线和结果，才是有效信息。",
  },
  // §57 — maleAudience
  engagementHumiliation: {
    label: "退婚/羞辱/三年之约",
    rule:
      "退婚、羞辱、立誓、三年之约等桥段。" +
      "其中过长嘲讽和重复看不起、无限加的新阻碍，是水；" +
      "羞辱的核心矛盾、主角誓言、后续目标，以及快速兑现前期承诺的比试，才是有效信息。",
  },
  // §58
  recruitingMinions: {
    label: "收小弟",
    rule:
      "收小弟。" +
      "其中“不服—震惊—拜服”的重复流程，以及没有功能性的跟随者，是水；" +
      "小弟的独特能力、背景麻烦和加入主角团的代价，才是有效信息。",
  },
  // §59
  haremRotation: {
    label: "后宫/暧昧角色轮番出场",
    rule:
      "多个暧昧角色轮番出场。" +
      "其中每个新地图都重复的相遇、误会、吃醋、含糊处理，是水；" +
      "对主线、人物选择或关系格局有影响的互动，以及带来情感推进的暧昧，才是有效信息。",
  },
  // §60
  treasureAppraisal: {
    label: "捡漏/鉴宝",
    rule:
      "捡漏、鉴宝、赌石、古玩、灵石等桥段。" +
      "其中市场闲逛、老板忽悠、路人嘲笑的重复流程，是水；" +
      "误判、主角识破玄机、低价获得、价值揭晓，以及每次捡漏的新机制或新后果，才是有效信息。",
  },
  // §61
  medicalRescue: {
    label: "医术救人",
    rule:
      "神医救人。" +
      "其中家属不信、名医质疑、针法解释等重复环节，是水；" +
      "病情危机、主角判断、关键治疗动作和治疗后果，以及读者理解反转所需的医学说明，才是有效信息。",
  },
  // §64 — sciFiApocalypse
  baseBuilding: {
    label: "基地建设",
    rule:
      "基地建设、围墙、防御、种植、人员分配。" +
      "其中工程流程和统计数据的堆砌，是水；" +
      "建设决策、资源矛盾、安全漏洞和管理后果，以及每项改变生存局势的建设，才是有效信息。",
  },
  // §66
  puzzleTrialError: {
    label: "解谜反复试错",
    rule:
      "悬疑、无限流、规则怪谈中的反复推理试错。" +
      "其中无效猜想和原地打转的讨论，是水；" +
      "关键线索、错误推理的代价、最终推翻点和正确结论，以及逐步接近真相的讨论，才是有效信息。",
  },
  // §67 — workplaceIndustry
  corporateMeetings: {
    label: "商战会议",
    rule:
      "商战会议、市场分析、股东争论、财报、公关方案。" +
      "其中PPT式数据堆叠和多人重复发言，是水；" +
      "决策冲突、风险变化、主角关键判断，以及产生行动方案或权力变化的会议，才是有效信息。",
  },
  // §68
  projectCompetition: {
    label: "公司对赌/项目竞争",
    rule:
      "公司项目竞争、方案比拼、客户刁难、上司偏心。" +
      "其中重复办公室闲话和无效使绊子，是水；" +
      "竞争目标、关键阻碍、主角破局和结果，以及体现能力差异或利益结构的冲突，才是有效信息。",
  },
  // §69
  actingAudition: {
    label: "娱乐圈试镜/拍戏",
    rule:
      "试镜、拍戏、剧本理解、导演质疑、演员挑衅。" +
      "其中完整戏中戏和重复惊艳反应，是水；" +
      "角色难点、主角表演突破和行业后果，以及服务人设、事业线或舆论变化的表演描写，才是有效信息。",
  },
  // §70
  fandomWars: {
    label: "粉圈撕番/控评",
    rule:
      "粉圈撕番、控评、黑稿、声明、CP粉狂欢。" +
      "其中大量同质评论和截图式内容，是水；" +
      "舆论转向和对角色事业的影响，才是有效信息。",
  },
  // §77 — plotLoop
  mapProgressionTemplate: {
    label: "小地图升级到大地图重复模板",
    rule:
      "每到新地图都重复“被看不起—惹小反派—打小反派—惹大反派—升级—换地图”的结构。" +
      "其中重复的前半段流程，是水；" +
      "新地图提供的新规则、敌人类型、人物关系或价值冲突，以及直接跳到的核心事件，才是有效信息。",
  },
  // §78
  escalatingCrisis: {
    label: "危机—解决—更大危机机械循环",
    rule:
      "危机刚解决又立刻出现更大危机。" +
      "其中只是事件堆叠、不改变人物的机械循环，是水；" +
      "每个危机的代价、选择或后果，以及合并或加过渡后的处理，才是有效信息。",
  },
  // §79
  infinitePrep: {
    label: "准备阶段无限拉长",
    rule:
      "大战前、婚礼前、考试前、比赛前的准备阶段。" +
      "其中装备、药品、计划、阵法、谈心、反派准备等冗长铺陈，是水；" +
      "影响最终事件结果的准备，以及尽快开始的核心事件，才是有效信息。",
  },
  // §80
  waitingForResults: {
    label: "等待结果",
    rule:
      "等待检测、榜单、判定、医生、系统结算、传承认可等结果。" +
      "其中等待期间的心理活动和群众讨论，是水；" +
      "等待造成的压力、误导或关系变化，以及尽快公布的结果，才是有效信息。",
  },
  // §81 — genreSpecific
  palaceEtiquette: {
    label: "宫斗：请安、赏赐、规矩",
    rule:
      "宫斗中的请安、位份、赏赐、宫规、传话、座次、行礼。" +
      "其中完整礼仪流程和赏赐清单，是水；" +
      "体现权力变化、明争暗斗或陷阱的礼仪细节，才是有效信息。",
  },
  // §82
  householdAccounts: {
    label: "宅斗：账本、嫁妆、管家权",
    rule:
      "宅斗中的账本、嫁妆、月例、铺子、下人、克扣银钱。" +
      "其中流水账式清单，是水；" +
      "关键账目问题、利益冲突和主角处理手段，以及导向权力变化的管家细节，才是有效信息。",
  },
  // §83
  farmingRoutine: {
    label: "种田：农活流程",
    rule:
      "种田文中的翻地、播种、浇水、施肥、收割、赶集、盖房等流程。" +
      "其中重复的农活，是水；" +
      "体现生产变化、生活改善或人物关系的步骤，以及带来治愈感或现实收益的细节，才是有效信息。",
  },
  // §84
  eraFictionCoupons: {
    label: "年代文：票证、物资、邻里八卦",
    rule:
      "年代文中的粮票、布票、工分、大院邻居、厂里评优、相亲、婆婆妈妈议论。" +
      "其中重复八卦和票证清单，是水；" +
      "体现时代约束、资源冲突和人际压力的内容，才是有效信息。",
  },
  // §85
  cthulhuDelaying: {
    label: "克苏鲁/悬疑：不可名状式拖延",
    rule:
      "不可名状、难以理解、诡异低语、似乎被注视、说不上哪里不对等悬疑氛围。" +
      "其中空泛重复的不可描述，是水；" +
      "能形成线索或恐惧升级的描写，以及之后给出的新线索、新危险或新认知偏差，才是有效信息。",
  },
};

/**
 * Build the outliner's system prompt. The outliner reads a chunk of raw novel
 * text and identifies "storyline units" — each may be a single original chapter
 * OR several consecutive original chapters MERGED into one (when they form a
 * single cross-chapter storyline: a tournament arc, a grinding sequence, a
 * multi-chapter event). For each unit it emits title + first/last text anchors
 * + outline + foreshadowing. The cross-chapter tactics table (when enabled)
 * serves as guidance for WHICH consecutive chapters should be merged — not as a
 * per-chapter flag (needsCrossWrite was removed; merging IS the cross-chapter
 * handling).
 */
function buildOutlineSystemPrompt(
  crossChapter: CrossChapterDehydrate,
): string {
  const sections: string[] = [];

  // Role + goal (always on).
  sections.push(
    "你是一名资深的中文小说连载编辑。你的任务是阅读给定的一段小说原文片段，" +
      "识别出其中的「剧情单元」，并为每个剧情单元同时产出章节切分与剧情大纲。" +
      "一个剧情单元可能是单个原章，也可能是**连续多个原章合并而成**——" +
      "当若干连续原章构成一个完整的跨章故事线（例如一整场擂台赛、一次连续刷怪、" +
      "一段被拆成多章的事件、一个完整的小高潮），把它们合并成一个剧情单元。",
  );

  // The deliverables (always on) — split + outline in ONE pass.
  sections.push(
    "对每个剧情单元（你能同时看到其正文开头和正文结尾），请产出：\n" +
      "- 标题：该剧情单元的标题，**必填，不允许为空或 null**。" +
      "**若该单元是单个有标题的原章**，直接沿用该原章标题" +
      "（如「第一章 风起」）；**若该单元由多个原章合并而成**，请为这条合并后的故事线**新拟一个简明标题**；" +
      "**若原小说本身不提供章节标题**，也请新拟一个简明标题。合并单元或无标题原文都必须给出新标题，不得留空。\n" +
      "- firstTextChunk：该剧情单元正文（标题行之后的内容）的前约 40 个字符，**逐字精确复制**自片段" +
      "（一个字符都不能改动、漏掉或新增，包括空白也必须一致）。系统会在片段中据此精确定位该单元的起始位置；" +
      "若有任何偏差，该单元会被跳过。\n" +
      "- lastTextChunk：该剧情单元正文最后约 40 个字符，**逐字精确复制**自片段（同样一个字符都不能差）。" +
      "系统会据此定位该单元的结束位置。**只有当你能看到该单元的正文结尾时才提交它**——" +
      "若某单元的结尾跑出了片段范围，不要提交它（它会在下一个片段中被覆盖）。\n" +
      "- 大纲：该剧情单元主要事件、人物决定、状态变化的简明概括（2-5 句，只述事实与推进，不复述原文描写）。" +
      "存入数据库为非空 TEXT 字段，**必须给出非空内容**，不得为空字符串。\n" +
      "- 伏笔/线索：字符串数组，用关键词列出该单元中出现、且后文会用到的线索与伏笔" +
      "（人物、物品、承诺、能力、关系、悬念等）。存入数据库为 JSON 字符串数组（NOT NULL，默认 '[]'），" +
      "**不接受 null**：若该单元没有伏笔，返回**空数组 []**，而非 null。每项为短语关键词，不是完整句子。" +
      "这些标签用于后续重写时确保伏笔不被意外删除。",
  );

  // Merge guidance — cross-chapter tactics describe patterns whose consecutive
  // chapters SHOULD be merged into one unit. Only enabled tactics appear.
  const tacticBlocks: string[] = [];
  for (const cat of CROSS_CHAPTER_CATEGORIES) {
    const on = cat.tactics.filter((k) => crossChapter.tactics[k]);
    if (!on.length) continue;
    const items = on.map(
      (k) =>
        `  · ${CROSS_CHAPTER_TACTICS[k].label}：${CROSS_CHAPTER_TACTICS[k].rule}`,
    );
    tacticBlocks.push(
      `- ${CROSS_CHAPTER_CATEGORY_LABELS[cat.key]}：\n${items.join("\n")}`,
    );
  }
  if (crossChapter.strength > 0 && tacticBlocks.length) {
    sections.push(
      [
        "合并判断依据：下面列出的跨章套路。当连续多个原章属于同一种套路、" +
          "共同构成一个完整故事线时，应将它们合并成一个剧情单元（firstTextChunk 取故事线起点，" +
          "lastTextChunk 取故事线终点）。每条说明这是什么套路、哪些是可压缩的水、哪些才是有效信息，" +
          "作为你判断合并与识别的依据。不属于这些套路的独立原章保持单独成章。",
        ...tacticBlocks,
      ].join("\n\n"),
    );
  }

  // Cumulative-context note (always on) — explains the prior-outline prefix.
  sections.push(
    "你会一次收到一段小说原文片段。如果你之前已经处理过更早的片段，本次输入会附带“前情大纲”" +
      "（之前每一章的大纲汇总）作为上下文，帮助你判断伏笔是否已埋、套路是否在重复。" +
      "请把前情大纲作为整体剧情的参照，但本次只需为“本次片段中能完整看到开头与结尾的剧情单元”产出结果。",
  );

  // Output contract (always on, English, closes the brief).
  sections.push(
    "The only thing you are allowed to do is to call the outputChapters tool:\n" +
      "- Place an array entry per storyline unit you can FULLY identify in the excerpt " +
      "(you can see BOTH its firstTextChunk AND its lastTextChunk), each carrying " +
      "title, firstTextChunk, lastTextChunk, outline, and foreshadowing (string " +
      "array, may be empty);\n" +
      "- `title`: REQUIRED — must never be empty or null. Reuse the original " +
      "chapter heading VERBATIM if the unit is a single original chapter that " +
      "has one; WRITE A NEW concise title if the unit MERGES several original " +
      "chapters, OR if the source novel has no chapter titles at all. Merged " +
      "and title-less units must carry a synthesized title;\n" +
      "- Copy firstTextChunk and lastTextChunk VERBATIM from the excerpt, " +
      "character for character — the system matches these exact strings to " +
      "slice the unit's source text; any deviation (a changed/dropped/inserted " +
      "character or whitespace) skips the unit;\n" +
      "- For a merged unit (multiple original chapters), firstTextChunk is the " +
      "start of the FIRST original chapter and lastTextChunk is the end of the " +
      "LAST original chapter in the merged storyline;\n" +
      "- Do NOT emit a unit whose end runs off the end of the excerpt — it will " +
      "be covered in the next excerpt;\n" +
      "- You are not allowed to output units anywhere other than the " +
      "outputChapters tool;\n" +
      "- You are not allowed to output anything other than calling the " +
      "outputChapters tool;\n" +
      "- `outline` is stored as a NOT NULL TEXT column — it must be a non-empty " +
      "brief factual summary; no explanations, asides, or preambles; do not " +
      "copy the original prose;\n" +
      "- `foreshadowing` is stored as a JSON string array in a NOT NULL column " +
      "(DB default '[]'). null is NOT accepted — return an empty array [] when " +
      "the unit plants none. Entries are short keywords/noun phrases, not " +
      "sentences; only include things that genuinely matter later;\n" +
      "- Emitting plain text without calling the outputChapters tool " +
      "will result in fatal failure.",
  );

  return sections.join("\n\n");
}

/**
 * Run one outliner-agent pass under `systemPrompt` for a single chunk's excerpt.
 * Returns whether the agent called `outputChapters` (the tool's execute already
 * sliced + wrote the rows on success) PLUS the provider-reported inputTokens,
 * which the chunk loop uses to calibrate chars-per-token against the real model
 * tokenizer (no more cl100k_base guessing after round 1). The `userContent`
 * carries the prior outlines (cumulative context) + this chunk's raw excerpt,
 * formatted as one message. `maxOutputTokens` (when set) caps the model's output.
 */
async function runOutlineAgent(params: {
  model: LanguageModel;
  maxOutputTokens?: number;
  systemPrompt: string;
  userContent: string;
  threadId: string;
  ctx: OutputChaptersContext;
}): Promise<{ saved: boolean; inputTokens?: number }> {
  const { model, maxOutputTokens, systemPrompt, userContent, threadId, ctx } =
    params;
  logger.debug("outliner agent chunk start", {
    threadId,
    userContentLen: userContent.length,
  });
  const result = streamText({
    model,
    ...(maxOutputTokens != null && { maxOutputTokens }),
    system: systemPrompt,
    messages: [{ role: "user", content: userContent }],
    tools: {
      outputChapters: makeOutputChaptersTool(),
    },
    toolChoice: { type: "tool", toolName: "outputChapters" },
    stopWhen: [hasSuccessfulToolResult("outputChapters"), stepCountIs(3)],
    maxRetries: settingsService.settings.maxRetries,
    timeout: TIMEOUTS.chat,
    experimental_context: ctx,
    experimental_telemetry: {
      isEnabled: settingsService.settings.langfuse.enabled,
      functionId: "entertainment-outliner",
      metadata: { threadId },
    },
  });
  const steps = await result.steps;
  const saved = steps
    .flatMap((s) => s.toolResults ?? [])
    .some(
      (tr) => tr.toolName === "outputChapters" && tr.type === "tool-result",
    );
  const usage = await result.totalUsage;
  const inputTokens = usage?.inputTokens;
  logger.debug("outliner agent chunk done", {
    threadId,
    saved,
    steps: steps.length,
    inputTokens,
    outputTokens: usage?.outputTokens,
  });
  return { saved, inputTokens };
}

// --- the public entry ------------------------------------------------------

/**
 * Generate outlines (and, in the same pass, split + MERGE the source into
 * chapters) for a file-uploaded novel. Owns the whole `source_chapters` row
 * lifecycle (outline/foreshadowing/outlineStatus now co-located on source rows).
 * Resumable: every round persists `rawConsumedOffset` to the DB, so a crashed
 * run picked back up continues from
 * the last committed chapter without re-processing completed ones and without
 * re-reading the original file (the decoded rawText is held in the DB for the
 * run's duration).
 *
 *   1. Load the rawText blob from DB into RAM once.
 *   2. Each round reads continuity fresh from DB: consumedOffset (from
 *      entertainment_configs.rawConsumedOffset) + nextChapterNumber (derived as
 *      max(source_chapters.chapterNumber) + 1) + priorOutline (rebuilt from
 *      already-outlined rows via the compressor when resuming). Each round
 *      boundary is a recovery point.
 *   3. Loop: planChunk sizes the read window by the INPUT context budget
 *      (maxContext − maxOutput − priorOutline − systemPrompt − toolOverhead −
 *      reserved), converted to chars via a chars-per-token that is bootstrapped
 *      from cl100k_base for round 1 (conservative → chunk smaller → safe) and
 *      then recalibrated each round from the model's REAL reported inputTokens
 *      (handles any model's tokenizer + the text's language mix — no guessing,
 *      no extra API calls). There is NO overlap — continuity between
 *      back-to-back rounds is provided by the unconditional DB carry-forward
 *      (the last source chapter's content is prepended to the next round's
 *      excerpt). Build the user message (prior outline prefix + raw excerpt),
 *      then run the agent (one-shot retry with RETRY_SUFFIX on a plain-text
 *      miss). The tool's execute slices verbatim bodies from the excerpt and
 *      writes a source_chapters row per chapter, advancing rawConsumedOffset.
 *   4. A chapter whose end falls off the chunk edge is simply not emitted this
 *      round; the next round's carry-forward re-covers it. A round that fails
 *      (no tool call after retry, or the tool commits nothing — typically a
 *      transient provider issue, NOT a malformed book) does NOT skip content:
 *      it sends an alert and returns early, leaving consumedOffset, the raw
 *      blob, and finalChapterNumber untouched. The user reopens the thread and
 *      `ensureRange` resumes from the last checkpoint — same loop, same offset.
 *   5. The round whose read window reaches EOF is the last batch (`isLastBatch`,
 *      threaded into the tool via experimental_context). The tool sets
 *      finalChapterNumber once that batch's rows land; the loop then exits. A
 *      convergence fallback finalizes at loop exit if the last batch committed
 *      nothing, and only then is the raw blob cleared (an interrupted run keeps
 *      it for resume).
 */
export async function generateOutlines(
  threadId: string,
  crossChapter: CrossChapterDehydrate,
): Promise<{ outlined: number; errored: number; skipped: number }> {
  const rawText = entertainmentService.getRawNovelText(threadId);
  if (!rawText || rawText.length === 0) {
    logger.warn("no raw text; cannot outline", { threadId });
    return { outlined: 0, errored: 0, skipped: 0 };
  }

  // Resolve the complex model ONCE: its SDK object is threaded into each
  // round's streamText call, and its contextWindow + maxOutputTokens drive the
  // chunk sizing (input-budget driven — see planChunk). maxOutputTokens is
  // optional on ResolvedModel; fall back to a quarter of the context window
  // (defensive — the user is expected to have assigned it via the model
  // catalog/override). Both it and maxOutputTokens cap the streamText call too.
  const complex = complexModel();
  const maxContext = complex.contextWindow;
  const maxOutputTokens = complex.maxOutputTokens ?? Math.floor(maxContext / 4);
  if (complex.maxOutputTokens == null) {
    logger.warn(
      "maxOutputTokens not set on model; falling back to contextWindow/4",
      { threadId, contextWindow: maxContext, fallback: maxOutputTokens },
    );
  }

  // Bootstrapped chars-per-token for round 1 using cl100k_base. cl100k_base is
  // conservative for Chinese-optimised models (tends to over-count Chinese →
  // chars/token estimate LOW → chunk SMALL → safe against overflow on round 1).
  // From round 2 on this is recalibrated from the real model's reported
  // inputTokens (see the loop below) — no probing API call, the chunk loop
  // calibrates itself. Zero means the bootstrap failed (empty/whitespace text).
  let charsPerToken = bootstrapCharsPerToken(rawText);
  // The outputChapters tool's description overhead, measured once (constant).
  const toolDescriptionTokens = tokensOf(OUTPUT_CHAPTERS_TOOL_DESCRIPTION);

  logger.info("outline run initialized", {
    threadId,
    rawTextLen: rawText.length,
    maxContext,
    maxOutputTokens,
    maxOutputTokensConfigured: complex.maxOutputTokens != null,
    bootstrapCharsPerToken: charsPerToken,
    toolDescriptionTokens,
    crossChapterStrength: crossChapter.strength,
  });

  let outlined = 0;
  let errored = 0;
  // In-RAM compressed prior outline prefix for cross-chapter context quality.
  // Rebuilt from DB on resume; grown across rounds via the compressor.
  let priorOutline = "";

  // Loop until the consumed offset reaches end of rawText.
  // Each iteration re-reads continuity state from DB so the loop self-corrects
  // to whatever execute persisted (RAM never drifts from DB).
  // Safety cap on iterations prevents an infinite loop if state goes bad.
  const MAX_ROUNDS = 10_000;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    // --- read continuity fresh from DB (recovery point) ---
    const consumedOffset = entertainmentService.getConsumedOffset(threadId);
    if (consumedOffset >= rawText.length) {
      logger.info("reached end of raw text", {
        threadId,
        consumedOffset,
        rawTextLen: rawText.length,
        round,
      });
      break;
    }

    // Rebuild prior outline on the FIRST round of a RESUME (consumedOffset > 0
    // and we haven't built it yet this run). On a fresh upload (consumedOffset
    // === 0) it stays empty. Reads source chapters' outline data (co-located
    // after the chapter_outlines table merge).
    if (round === 0 && consumedOffset > 0 && !priorOutline) {
      const doneSources = entertainmentService
        .listSourceChapters(threadId)
        .filter((s) => s.outlineStatus === "outlined");
      const doneOutlines = doneSources.map(
        (s) => `第 ${s.chapterNumber} 章：${s.outline}`,
      );
      if (doneOutlines.length > 0) {
        const recovered = await compressPriorOutline(threadId, doneOutlines);
        priorOutline = recovered ?? doneOutlines.join("\n");
        logger.info("recovered prior outline on resume", {
          threadId,
          doneChapters: doneOutlines.length,
          recovered: !!recovered,
          priorLen: priorOutline.length,
        });
      }
    }

    // --- UNCONDITIONAL DB CARRY-FORWARD (READ ONLY) ---
    // Unless this is the novel's last chapter (EOF reached above), carry the
    // last source chapter's content into this round: READ its text from DB and
    // prepend it to the new excerpt. The model sees one continuous text with no
    // annotation — it cannot tell where the carried text ends and new text
    // begins. If a cross-chapter storyline was cut at the chunk boundary, the
    // carried first half + new second half let the model merge them into one
    // unit naturally. No flags, no special prompt — EOF is the sole gate.
    //
    // NOTE: we do NOT delete the carried row here. Its chapterNumber is stashed
    // in `carryChapterNumber` and threaded into the tool's context; `execute`
    // deletes the row at the last possible moment — right before its first
    // insert, and only if it actually commits rows. This keeps the row alive on
    // a failed round (no tool call, or execute slices nothing / throws) so the
    // next round re-carries it instead of dropping that chapter on the floor.
    let carryContent = "";
    let carryChars = 0;
    let carryTokens = 0;
    let carryChapterNumber: number | null = null;
    const lastChapterNum =
      entertainmentService.maxSourceChapterNumber(threadId);
    if (lastChapterNum > 0) {
      const lastSource = entertainmentService.getSourceChapter(
        threadId,
        lastChapterNum,
      );
      if (lastSource?.content) {
        carryContent = lastSource.content;
        carryChars = carryContent.length;
        carryTokens = tokensOf(carryContent);
        carryChapterNumber = lastChapterNum;
        logger.debug("carry-forward: read last chapter for re-merge", {
          threadId,
          chapterNumber: lastChapterNum,
          carryChars,
          carryTokens,
        });
      }
    }

    // --- next chapter number: DB is the single source of truth ---
    // Computed AFTER the carry-forward read above. On a carry round, the carried
    // row is still in the DB at this point (execute deletes it right before its
    // first insert), so `carryChapterNumber` is the slot the re-merged unit must
    // recycle — feeding it here keeps chapter numbers gap-free: the carried row
    // is deleted and immediately re-filled at the same number. On a no-carry
    // round (first round, or resuming with no prior chapters) fall back to
    // max(chapterNumber)+1.
    const nextChapterNumber =
      carryChapterNumber ?? entertainmentService.maxSourceChapterNumber(threadId) + 1;

    // Build this round's system prompt and measure its token cost for the
    // input-budget calculation.
    const systemPrompt = buildOutlineSystemPrompt(crossChapter);
    const systemPromptTokens = tokensOf(systemPrompt);
    const priorOutlineTokens = priorOutline ? tokensOf(priorOutline) : 0;

    // --- plan the read window for this round (input-budget driven) ---
    // The carry-forward content's tokens are deducted from the budget so new
    // text is read less. NO overlap — the carry IS the continuity mechanism.
    const plan = planChunk({
      rawTextLen: rawText.length,
      consumedOffset,
      maxContext,
      maxOutputTokens,
      priorOutlineTokens,
      systemPromptTokens,
      toolDescriptionTokens,
      charsPerToken,
      carryTokens,
    });
    const newExcerpt = rawText.slice(plan.readStart, plan.readEnd);
    // This batch reads to EOF — the agent finalizes the thread on it (via the
    // isLastBatch flag in the tool context). The loop exits after this round.
    const isLastBatch = plan.readEnd >= rawText.length;
    // The combined excerpt the model sees: carried content (if any) + new text,
    // with NO separator or annotation — one continuous stream.
    const excerpt = carryContent + newExcerpt;

    logger.debug("round planned", {
      threadId,
      round,
      consumedOffset,
      nextChapterNumber,
      readStart: plan.readStart,
      readEnd: plan.readEnd,
      newExcerptLen: newExcerpt.length,
      carryChars,
      excerptLen: excerpt.length,
      excerptCharBudget: plan.excerptCharBudget,
      charsPerToken,
      priorOutlineLen: priorOutline.length,
      priorOutlineTokens,
      systemPromptTokens,
    });

    // --- build the user message: prior prefix + combined excerpt ---
    const userContent = buildUserMessage(priorOutline, excerpt);

    // --- run the agent (one pass, single tool call) ---
    const ctx: OutputChaptersContext = {
      threadId,
      sliceText: excerpt,
      searchFrom: 0, // search from the start of the combined text
      carryChars,
      carryChapterNumber,
      consumedOffset,
      nextChapterNumber,
      isLastBatch,
    };

    let saved = false;
    let roundInputTokens: number | undefined;
    let retried = false;
    try {
      const r = await runOutlineAgent({
        model: complex.model,
        maxOutputTokens,
        systemPrompt,
        userContent,
        threadId,
        ctx,
      });
      saved = r.saved;
      roundInputTokens = r.inputTokens;
      if (!saved) {
        retried = true;
        logger.warn("outliner did not call tool; retrying", {
          threadId,
          round,
          readStart: plan.readStart,
          readEnd: plan.readEnd,
          userContentLen: userContent.length,
        });
        const r2 = await runOutlineAgent({
          model: complex.model,
          maxOutputTokens,
          systemPrompt: systemPrompt + RETRY_SUFFIX,
          userContent,
          threadId,
          ctx,
        });
        saved = r2.saved;
        roundInputTokens = r2.inputTokens;
        if (saved) {
          logger.info("outliner retry succeeded", { threadId, round });
        }
      }
    } catch (err) {
      logger.error("outliner round threw", {
        threadId,
        round,
        retried,
        err,
      });
    }

    // Calibrate chars-per-token from the REAL model's reported inputTokens.
    // The model's inputTokens counts system + user + framework envelope; we only
    // want the USER-message portion (system prompt + tool-schema are fixed
    // overheads measured upstream via cl100k_base, and their cl100k_base count
    // is as good as the model's for those small stable strings). Subtract them
    // so the ratio is anchored to userContent (prior outline + excerpt) — the
    // part whose char/token ratio is what we actually size on. Never goes below
    // 1 so we never divide by zero.
    if (roundInputTokens && roundInputTokens > 0) {
      const fixedOverhead = systemPromptTokens + toolDescriptionTokens;
      const userMessageTokens = Math.max(1, roundInputTokens - fixedOverhead);
      const prior = charsPerToken;
      charsPerToken = calibrateCharsPerToken(
        charsPerToken,
        userContent.length,
        userMessageTokens,
      );
      if (charsPerToken !== prior) {
        logger.debug("calibrated chars-per-token", {
          threadId,
          round,
          prior,
          userChars: userContent.length,
          totalInputTokens: roundInputTokens,
          fixedOverhead,
          userMessageTokens,
          charsPerToken,
        });
      }
    }

    // --- failure handling: alert + stop, never skip content ---
    // Two failure modes both mean "this round produced nothing" and both are
    // treated the same way — they are almost always transient provider issues
    // (rate limit, 5xx, internal filter, a one-off bad output), NOT a malformed
    // book. The old code force-advanced consumedOffset past the stuck window,
    // which SILENTLY DROPPED that text forever. Instead: send a persistent
    // alert, return early, and leave DB state untouched so the user can reopen
    // the thread and `ensureRange` resumes from the last checkpoint.
    //
    //   !saved                  — model never produced a usable tool call,
    //                              even after the one-shot RETRY_SUFFIX retry.
    //   chaptersCommitted === 0 — tool ran but sliced nothing (all anchors
    //                              missed); execute's early-return already left
    //                              consumedOffset and the carried row untouched.
    //
    // We early-return BEFORE the finalize block, so: raw blob stays in DB,
    // consumedOffset holds the last successful round's value, and
    // finalChapterNumber stays null — exactly the resumable state ensureRange
    // re-enters on the next thread open.
    const newConsumedOffset = entertainmentService.getConsumedOffset(threadId);
    const chaptersCommitted = saved ?
      Math.max(
        0,
        entertainmentService.maxSourceChapterNumber(threadId) -
          (nextChapterNumber - 1),
      )
    : 0;

    if (!saved || chaptersCommitted === 0) {
      errored++;
      const reason = !saved ?
        "model did not call the outputChapters tool after retry"
      : "tool committed nothing (all anchors missed)";
      logger.error("outliner round failed; stopping for user retry", {
        threadId,
        round,
        reason,
        consumedOffset,
        newConsumedOffset,
        readStart: plan.readStart,
        readEnd: plan.readEnd,
      });
      sendAlert(
        i18n.t("entertainment.outlineTransientFailedTitle"),
        i18n.t("entertainment.outlineTransientFailedBody", {
          round: round + 1,
        }),
      );
      return { outlined, errored, skipped: 0 };
    }
    outlined += chaptersCommitted;

    // Absorb + compress the cumulative prior outline for the next round.
    // Reads source chapters' outline data (co-located after the table merge).
    const newOutlines: string[] = [];
    for (
      let n = nextChapterNumber;
      n < nextChapterNumber + chaptersCommitted;
      n++
    ) {
      const src = entertainmentService.getSourceChapter(threadId, n);
      if (src && src.outlineStatus === "outlined") {
        newOutlines.push(`第 ${n} 章：${src.outline}`);
      }
    }
    if (newOutlines.length > 0) {
      const merged =
        priorOutline.length > 0 ?
          [priorOutline, ...newOutlines].join("\n")
        : newOutlines.join("\n");
      const compressed = await compressPriorOutline(threadId, [merged]);
      priorOutline = compressed ?? merged;
    }

    logger.debug("outliner round done", {
      threadId,
      round,
      chaptersCommitted,
      newConsumedOffset,
      priorOutlineLen: priorOutline.length,
    });

    // The last batch reached EOF — the tool already set finalChapterNumber on a
    // successful commit, so there is no more text to read. Exit the loop.
    if (isLastBatch) {
      logger.info("outliner reached the last batch; exiting loop", {
        threadId,
        round,
      });
      break;
    }
  }

  // Loop exit. The agent normally sets finalChapterNumber on the last batch
  // (EOF) and a failed round returns early before reaching here, so the only
  // way to land here with finalChapterNumber still null is the MAX_ROUNDS safety
  // cap (a pathologically long book that never reaches EOF in 10k rounds).
  // Finalize in that case so the thread can't get stuck mid-book — buildOutlines'
  // guard blocks re-entry once this is set. Only then is the raw blob dead
  // weight; an interrupted (alerted) run keeps it for resume by returning early
  // above, never reaching this block.
  if (entertainmentService.getFinalChapterNumber(threadId) == null) {
    logger.warn("missing final chapter number, set the number manually");
    const finalChapter = entertainmentService.maxSourceChapterNumber(threadId);
    if (finalChapter > 0) {
      entertainmentService.setFinalChapterNumber(threadId, finalChapter);
    }
  }
  entertainmentService.clearRawNovelText(threadId);

  logger.info("outline run complete", {
    threadId,
    outlined,
    errored,
    finalChapter: entertainmentService.getFinalChapterNumber(threadId),
    finalCharsPerToken: charsPerToken,
    rawTextCleared: true,
  });
  return { outlined, errored, skipped: 0 };
}

/**
 * Build the user message for one round: optional compressed prior-outline
 * prefix + the raw excerpt. No resume/continuity note — the carry-forward
 * design feeds the previous round's last row verbatim into this round's
 * excerpt (one continuous stream, no boundary annotation), so there is no
 * chapter-edge to point the model at.
 */
function buildUserMessage(
  priorOutline: string,
  excerpt: string,
): string {
  const parts: string[] = [];
  if (priorOutline) {
    parts.push(
      "前情大纲（之前章节的概括，作为上下文参考，本次无需为这些章节产出结果）：\n" +
        priorOutline,
    );
  }
  parts.push("本次需要处理的小说原文片段：\n" + excerpt);
  return parts.join("\n\n");
}
