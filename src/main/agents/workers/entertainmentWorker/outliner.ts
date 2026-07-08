import { streamText, stepCountIs, tool } from "ai";
import { z } from "zod";
import log from "electron-log/main";
import { complexModel } from "@agents/providers";
import type { LanguageModel } from "ai";
import { hasSuccessfulToolResult, TIMEOUTS } from "@agents/utils";
import { settingsService, entertainmentService } from "@/services";
import type {
  CrossChapterCategory,
  CrossChapterDehydrate,
  CrossChapterTactics,
} from "@shared";
import { CROSS_CHAPTER_CATEGORIES } from "@shared";
import {
  planChunk,
  sliceChapters,
  initialAvgCharsPerChapter,
  recomputeAvgCharsPerChapter,
  bootstrapCharsPerToken,
  calibrateCharsPerToken,
  tokensOf,
  type ChapterEntry,
  type SliceResult,
} from "./textChunker";
import { compressPriorOutline } from "./outlineCompressor";

const logger = log.scope("Dehydrate:Outliner");

/**
 * Progress callback — fired once per chapter whose source + outline just
 * landed. The scheduler uses this to enqueue that chapter's rewrite the moment
 * it's ready, so rewriting does NOT wait for the whole book.
 */
export type OnChapterOutlined = (chapterNumber: number) => void;

/**
 * The `outputChapters` tool — the outliner agent's terminal tool and the ONLY
 * way it delivers its result. ONE call, ONE pass: the model emits one entry per
 * chapter it can fully identify in the excerpt (both its first and last
 * text-chunk anchors visible), and the tool's execute runs self-contained
 * deterministic logic to slice each chapter's verbatim body out of the full
 * rawText, then writes BOTH `source_chapters` (title + verbatim content) AND
 * `chapter_outlines` (outline + foreshadowing + needsCrossWrite) rows together.
 *
 * This merges chapter-splitting (previously the regex chapterParser) into the
 * outliner in a single pass per chunk. The model contributes boundaries (the two
 * text-chunk anchors) + outline metadata; the system contributes the exact
 * verbatim body (zero fidelity loss — the rewriter feeds source_chapters.content
 * verbatim, so paraphrase/truncation by the model would corrupt it).
 *
 * `threadId` / `rawText` / `searchFrom` / `nextChapterNumber` / `onCommit` all
 * arrive via `experimental_context` (zero-token — never in the prompt). Named as
 * an output verb so the model reads it as "this is how I hand back the chapters",
 * not a side-effect save it might skip.
 */
const OUTPUT_CHAPTERS_TOOL_DESCRIPTION =
  "The ONLY way to end your output and deliver the chapters — " +
  "call this outputChapters tool with one entry per chapter you can FULLY " +
  "identify in the excerpt (you can see BOTH its opening and its closing text). " +
  "For each chapter, provide its title, the first ~40 and last ~40 characters of " +
  "its BODY (copied VERBATIM from the excerpt — the system locates these to slice " +
  "the exact source text), plus its outline, foreshadowing, and needsCrossWrite. " +
  "You are NOT ALLOWED to output chapters as plain text and stop your output; " +
  "they must go through this outputChapters tool. " +
  "Only emit a chapter when you can see BOTH its firstTextChunk AND its " +
  "lastTextChunk in the excerpt — if a chapter's end runs off the end of the " +
  "excerpt, DO NOT emit it (it will be covered in the next excerpt).";

/**
 * Context threaded into the tool's `execute` via `experimental_context` — kept
 * out of the prompt so it costs zero tokens. Holds everything execute needs to
 * slice verbatim bodies + write rows without touching RAM state the loop owns.
 */
interface OutputChaptersContext {
  threadId: string;
  /** The full decoded novel text (held in RAM for the whole run). */
  rawText: string;
  /** Lower bound for anchor search (= consumedOffset). */
  searchFrom: number;
  /** The next chapter number to assign (system-assigned, gap-free). */
  nextChapterNumber: number;
  /** Per-commit progress callback (fires the scheduler's rewrite enqueue). */
  onCommit: (chapterNumber: number) => void;
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
              .nullable()
              .describe(
                "Verbatim heading text of this chapter (e.g. '第一章 风起'). " +
                  "null if the fragment starts mid-chapter with no heading line.",
              ),
            firstTextChunk: z
              .string()
              .min(1)
              .describe(
                "The first ~40 characters of the chapter BODY (the text AFTER " +
                  "the heading line), copied VERBATIM from the excerpt. The " +
                  "system locates this string to find the chapter's start.",
              ),
            lastTextChunk: z
              .string()
              .min(1)
              .describe(
                "The last ~40 characters of the chapter BODY, copied VERBATIM " +
                  "from the excerpt. The system locates this string to find the " +
                  "chapter's end. Only emit this chapter if you can see its end.",
              ),
            outline: z
              .string()
              .min(1)
              .describe(
                "A brief plot summary of this chapter: the main events, " +
                  "character decisions, and any status changes, in 2-5 sentences.",
              ),
            foreshadowing: z
              .array(z.string())
              .describe(
                "Keywords naming every clue, foreshadowing, planted hook, or " +
                  "promised payoff that appears in this chapter and matters " +
                  "later. May be empty if the chapter plants none.",
              ),
            needsCrossWrite: z
              .boolean()
              .describe(
                "true if this chapter touches any of the cross-chapter patterns " +
                  "listed in the instructions (a recurring beat that must " +
                  "progress, info already established elsewhere, a reveal/" +
                  "suspense/POV beat orchestrated across chapters); false " +
                  "otherwise.",
              ),
          }),
        )
        .min(1),
    }),
    execute: async (input, { experimental_context }) => {
      const ctx = experimental_context as OutputChaptersContext;
      const result: SliceResult = sliceChapters({
        rawText: ctx.rawText,
        entries: input.chapters as ChapterEntry[],
        searchFrom: ctx.searchFrom,
        nextChapterNumber: ctx.nextChapterNumber,
      });

      let saved = 0;
      for (const ch of result.committed) {
        // Write the source row (verbatim body, heading excluded → in `title`).
        entertainmentService.insertSourceChapter({
          threadId: ctx.threadId,
          chapterNumber: ch.chapterNumber,
          title: ch.title,
          content: ch.body,
          status: "fetched",
        });
        // Write the outline row.
        entertainmentService.insertOutline({
          threadId: ctx.threadId,
          chapterNumber: ch.chapterNumber,
          status: "outlined",
        });
        entertainmentService.updateOutline(ctx.threadId, ch.chapterNumber, {
          outline: ch.outline,
          foreshadowing: JSON.stringify(ch.foreshadowing),
          needsCrossWrite: ch.needsCrossWrite,
          status: "outlined",
        });
        try {
          ctx.onCommit(ch.chapterNumber);
        } catch (cbErr) {
          logger.warn("onCommit callback threw", {
            threadId: ctx.threadId,
            chapterNumber: ch.chapterNumber,
            err: cbErr,
          });
        }
        saved++;
      }

      // Persist the advanced consumed offset → this round is a recovery point.
      entertainmentService.setConsumedOffset(ctx.threadId, result.newConsumedOffset);

      if (result.skipped.length > 0) {
        logger.warn("tool: chapter entries skipped (anchors not found)", {
          threadId: ctx.threadId,
          skipped: result.skipped.length,
          reasons: result.skipped.map((s) =>
            s.kind === "skipped" ? s.reason : "committed",
          ),
        });
      }
      logger.info("tool: chapters committed", {
        threadId: ctx.threadId,
        saved,
        skipped: result.skipped.length,
        newConsumedOffset: result.newConsumedOffset,
        chapters: result.committed.map((c) => c.chapterNumber),
        truncated: result.committed.filter((c) => c.truncated).map((c) => c.chapterNumber),
        needsCrossWrite: result.committed
          .filter((c) => c.needsCrossWrite)
          .map((c) => c.chapterNumber),
      });
      return { saved, newConsumedOffset: result.newConsumedOffset };
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
Please resubmit now: call the outputChapters tool \
with one entry per chapter you can FULLY identify in the excerpt, each carrying \
title, firstTextChunk, lastTextChunk, outline, foreshadowing, and needsCrossWrite. \
Only emit a chapter if you can see BOTH its firstTextChunk AND its lastTextChunk. \
Do not output plain text, and do not write any content outside of the tool call.`;

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
// injects only the tactics the user enabled, as the patterns the agent must
// watch for when deciding each chapter's `needsCrossWrite` flag.
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
 * pattern and the filler-vs-core split. Here it doubles as the description of a
 * cross-chapter pattern the outliner must recognize: a chapter that touches it
 * is a candidate for `needsCrossWrite: true`. Text transcribed verbatim from
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
 * Build the outliner's system prompt. Mirrors `buildRewriteSystemPrompt`'s
 * situational-tactics section: only enabled tactics appear, grouped by
 * category, gated on `crossChapter.strength > 0`. The tactics here are NOT
 * dehydration orders (the outliner does not rewrite) — they are the patterns
 * the agent must recognize when deciding each chapter's `needsCrossWrite` flag,
 * and the context for what "cross-chapter co-writing" will later compress.
 *
 * `continueFromChapter` (when ≥1, i.e. not the first chunk) adds a one-line
 * continuity note so the model knows the previous excerpt ended at chapter N-1
 * and may begin with that chapter's tail (which it should ignore).
 */
function buildOutlineSystemPrompt(
  crossChapter: CrossChapterDehydrate,
  continueFromChapter: number,
): string {
  const sections: string[] = [];

  // Role + goal (always on).
  sections.push(
    "你是一名资深的中文小说连载编辑。你的任务是阅读给定的一段小说原文片段，" +
      "在这一段中识别出你能完整看到开头和结尾的每一章，为每一章同时产出章节切分与剧情大纲，" +
      "供后续的「章节并写」工序使用：",
  );

  // The deliverables (always on) — split + outline in ONE pass.
  sections.push(
    "对每一章（你能同时看到其正文开头和正文结尾的章节），请产出：\n" +
      "- 标题：该章的标题行原文（如「第一章 风起」）。若片段从该章正文中间开始、没有标题行，填 null。\n" +
      "- firstTextChunk：该章正文（标题行之后的内容）的前约 40 个字符，**逐字复制**自片段。" +
      "系统会据此在全文中定位该章的起始位置。\n" +
      "- lastTextChunk：该章正文最后约 40 个字符，**逐字复制**自片段。" +
      "系统会据此定位该章的结束位置。**只有当你能看到该章的正文结尾时才提交该章**——" +
      "若某章的结尾跑出了片段范围，不要提交它（它会在下一个片段中被覆盖）。\n" +
      "- 大纲：本章主要事件、人物决定、状态变化的简明概括（2-5 句，只述事实与推进，不复述原文描写）。\n" +
      "- 伏笔/线索：用关键词列出本章中出现、且后文会用到的线索与伏笔（人物、物品、承诺、能力、关系、悬念等）；" +
      "没有就留空数组。这些关键词用于后续重写时确保伏笔不被意外删除。\n" +
      "- 是否需要章节并写：本章是否触及下面列出的任何跨章套路。若触及任意一条，标 true；否则标 false。",
  );

  // Cross-chapter tactics — only when strength > 0, only the checked ones.
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
        "“是否需要章节并写”的判断依据：下面列出的跨章套路。" +
          "本章只要出现其中任意一种模式（即使只是一处），就把 needsCrossWrite 标为 true；" +
          "完全没有出现的章节才标 false。每条只说明这是什么套路、哪些是可压缩的水、哪些才是有效信息，" +
          "作为你识别的依据。",
        ...tacticBlocks,
      ].join("\n\n"),
    );
  } else {
    // strength = 0 or no tactics checked — nothing crosses chapters.
    sections.push(
      "本次未勾选任何跨章套路，所有章节的 needsCrossWrite 一律标 false。",
    );
  }

  // Cumulative-context note (always on) — explains the prior-outline prefix.
  sections.push(
    "你会一次收到一段小说原文片段。如果你之前已经处理过更早的片段，本次输入会附带“前情大纲”" +
      "（之前每一章的大纲汇总）作为上下文，帮助你判断伏笔是否已埋、套路是否在重复。" +
      "请把前情大纲作为整体剧情的参照，但本次只需为“本次片段中能完整看到开头与结尾的章节”产出结果。",
  );

  // Continuity note (when not the first chunk) — tells the model where to resume.
  if (continueFromChapter >= 1) {
    sections.push(
      `本次片段接续自上一段。上一段最后处理到第 ${continueFromChapter} 章；` +
        `本片段开头可能包含该章的尾部内容——这部分你已处理过，不要重复提交。` +
        `从第 ${continueFromChapter + 1} 章开始提交（若其正文开头和结尾都可见）。`,
    );
  }

  // Output contract (always on, English, closes the brief).
  sections.push(
    "The only thing you are allowed to do is to call the outputChapters tool:\n" +
      "- Place an array entry per chapter you can FULLY identify in the excerpt " +
      "(you can see BOTH its firstTextChunk AND its lastTextChunk), each carrying " +
      "title, firstTextChunk, lastTextChunk, outline, foreshadowing (string array, " +
      "may be empty), and needsCrossWrite (boolean);\n" +
      "- Copy firstTextChunk and lastTextChunk VERBATIM from the excerpt — the " +
      "system locates these exact strings to slice the chapter's source text;\n" +
      "- Do NOT emit a chapter whose end runs off the end of the excerpt — it will " +
      "be covered in the next excerpt;\n" +
      "- You are not allowed to output chapters anywhere other than the " +
      "outputChapters tool;\n" +
      "- You are not allowed to output anything other than calling the " +
      "outputChapters tool;\n" +
      "- `outline` must be a brief factual summary: no explanations, asides, " +
      "or preambles; do not copy the original prose;\n" +
      "- `foreshadowing` entries are short keywords/noun phrases, not " +
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
 * Generate outlines (and, in the same pass, split the source into chapters)
 * for a file-uploaded novel. Owns the whole `source_chapters` +
 * `chapter_outlines` row lifecycle. Resumable: every round persists
 * `rawConsumedOffset` to the DB, so a crashed run picked back up continues from
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
 *      no extra API calls). A generous overlap (≈1.5× the
 *      observed average chapter length) guarantees ≥1 chapter of continuity
 *      between back-to-back agent calls. Build the user message (prior outline
 *      prefix + raw excerpt). Run the agent (one-shot retry with RETRY_SUFFIX on
 *      a plain-text miss). The tool's execute slices verbatim bodies via
 *      textChunker and writes BOTH tables per chapter, advancing
 *      rawConsumedOffset.
 *   4. A chapter whose end falls off the chunk edge is simply not emitted this
 *      round; the next round's overlap re-covers it (no held-chapter state
 *      machine). Giant-chapter safeguard: if a round commits nothing, force-
 *      advance + retry; if still nothing, commit a truncated chapter.
 *   5. At EOF: setFinalChapterNumber + clearRawNovelText (the blob is dead
 *      weight once the run is complete; isOutlineComplete blocks re-entry).
 *
 * `onChapterOutlined` is called once per chapter whose source + outline just
 * landed, in chapter order within each round. The caller (scheduler) uses it to
 * `ensure` that chapter's rewrite.
 */
export async function generateOutlines(
  threadId: string,
  crossChapter: CrossChapterDehydrate,
  onChapterOutlined?: OnChapterOutlined,
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
  const maxOutputTokens =
    complex.maxOutputTokens ?? Math.floor(maxContext / 4);
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

  // Self-tuning average chapter length (chars). Starts from the initial
  // estimate; recomputed each round from observed throughput.
  let avgCharsPerChapter = initialAvgCharsPerChapter();

  let outlined = 0;
  let errored = 0;
  let consecutiveZeroRounds = 0;
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
    const nextChapterNumber =
      entertainmentService.maxSourceChapterNumber(threadId) + 1;

    // Rebuild prior outline on the FIRST round of a RESUME (consumedOffset > 0
    // and we haven't built it yet this run). On a fresh upload (consumedOffset
    // === 0) it stays empty.
    if (round === 0 && consumedOffset > 0 && !priorOutline) {
      const doneRows = entertainmentService.listOutlines(threadId);
      const doneOutlines = doneRows
        .filter((o) => o.status === "outlined")
        .map((o) => `第 ${o.chapterNumber} 章：${o.outline}`);
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

    const continueFromChapter = nextChapterNumber - 1; // 0 on a fresh upload

    // Build this round's system prompt (varies by continueFromChapter) and
    // measure its token cost for the input-budget calculation.
    const systemPrompt = buildOutlineSystemPrompt(
      crossChapter,
      continueFromChapter,
    );
    const systemPromptTokens = tokensOf(systemPrompt);
    const priorOutlineTokens = priorOutline ? tokensOf(priorOutline) : 0;

    // --- plan the read window for this round (input-budget driven) ---
    const plan = planChunk({
      rawTextLen: rawText.length,
      consumedOffset,
      maxContext,
      maxOutputTokens,
      priorOutlineTokens,
      systemPromptTokens,
      toolDescriptionTokens,
      charsPerToken,
      avgCharsPerChapter,
    });
    const excerpt = rawText.slice(plan.readStart, plan.readEnd);

    logger.debug("round planned", {
      threadId,
      round,
      consumedOffset,
      nextChapterNumber,
      readStart: plan.readStart,
      readEnd: plan.readEnd,
      excerptLen: excerpt.length,
      excerptCharBudget: plan.excerptCharBudget,
      overlapChars: plan.overlapChars,
      charsPerToken,
      avgCharsPerChapter,
      priorOutlineLen: priorOutline.length,
      priorOutlineTokens,
      systemPromptTokens,
    });

    // --- build the user message: prior prefix + raw excerpt ---
    const userContent = buildUserMessage(priorOutline, continueFromChapter, excerpt);

    // --- run the agent (one pass, single tool call) ---
    const ctx: OutputChaptersContext = {
      threadId,
      rawText,
      searchFrom: consumedOffset,
      nextChapterNumber,
      onCommit: (n) => {
        try {
          onChapterOutlined?.(n);
        } catch (cbErr) {
          logger.warn("onChapterOutlined callback threw", {
            threadId,
            chapterNumber: n,
            err: cbErr,
          });
        }
      },
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
      const userMessageTokens = Math.max(
        1,
        roundInputTokens - fixedOverhead,
      );
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

    if (!saved) {
      // Round failed after retry. The tool didn't persist anything for this
      // round, so consumedOffset is unchanged — but we must make progress or
      // the loop is stuck. Advance the offset by the excerpt budget (the
      // chapters in this window are lost to error; they'll be missing from
      // source/outline tables but the loop continues). No reliable chapter
      // count to attribute (we never sliced), so count the round, not chapters.
      errored++;
      entertainmentService.setConsumedOffset(
        threadId,
        Math.min(rawText.length, consumedOffset + plan.excerptCharBudget),
      );
      consecutiveZeroRounds = 0;
      logger.error("outliner round failed after retry; advancing offset", {
        threadId,
        round,
      });
      continue;
    }

    // Tool succeeded. Re-read what it persisted.
    const newConsumedOffset = entertainmentService.getConsumedOffset(threadId);
    const chaptersCommitted = Math.max(
      0,
      entertainmentService.maxSourceChapterNumber(threadId) -
        (nextChapterNumber - 1),
    );
    outlined += chaptersCommitted;

    if (chaptersCommitted === 0) {
      // Tool returned but sliced nothing (all entries' anchors missed).
      // Giant-chapter safeguard: force-advance and, if stuck twice, jump
      // a full excerpt so the loop always makes progress.
      consecutiveZeroRounds++;
      if (consecutiveZeroRounds >= 2) {
        logger.warn(
          "outliner round committed nothing twice; force-advancing past the stuck window",
          { threadId, round, consumedOffset, readStart: plan.readStart, readEnd: plan.readEnd },
        );
        entertainmentService.setConsumedOffset(
          threadId,
          Math.min(rawText.length, newConsumedOffset + plan.excerptCharBudget),
        );
        consecutiveZeroRounds = 0;
      } else {
        // Force-advance by half an excerpt and let the next overlap retry.
        logger.warn(
          "outliner round committed nothing; nudging offset forward",
          { threadId, round, consumedOffset, newConsumedOffset },
        );
        entertainmentService.setConsumedOffset(
          threadId,
          Math.min(
            rawText.length,
            newConsumedOffset + Math.floor(plan.excerptCharBudget / 2),
          ),
        );
      }
      continue;
    }
    consecutiveZeroRounds = 0;

    // Self-tune the average chapter length from this round's throughput.
    const charsConsumed = Math.max(0, newConsumedOffset - consumedOffset);
    avgCharsPerChapter = recomputeAvgCharsPerChapter(
      avgCharsPerChapter,
      charsConsumed,
      chaptersCommitted,
    );

    // Absorb + compress the cumulative prior outline for the next round.
    const newOutlines: string[] = [];
    for (let n = nextChapterNumber; n < nextChapterNumber + chaptersCommitted; n++) {
      const row = entertainmentService.getOutline(threadId, n);
      if (row && row.status === "outlined") {
        newOutlines.push(`第 ${n} 章：${row.outline}`);
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
      avgCharsPerChapter,
      priorOutlineLen: priorOutline.length,
    });
  }

  // EOF: set final chapter number (count is now known) + clear the raw blob.
  const finalChapter = entertainmentService.maxSourceChapterNumber(threadId);
  if (finalChapter > 0) {
    entertainmentService.setFinalChapterNumber(threadId, finalChapter);
  }
  entertainmentService.clearRawNovelText(threadId);

  logger.info("outline run complete", {
    threadId,
    outlined,
    errored,
    finalChapter,
    finalCharsPerToken: charsPerToken,
    rawTextCleared: true,
  });
  return { outlined, errored, skipped: 0 };
}

/**
 * Build the user message for one round: optional compressed prior-outline
 * prefix + the raw excerpt, with the continuity chapter noted.
 */
function buildUserMessage(
  priorOutline: string,
  continueFromChapter: number,
  excerpt: string,
): string {
  const parts: string[] = [];
  if (priorOutline) {
    parts.push(
      "前情大纲（之前章节的概括，作为上下文参考，本次无需为这些章节产出结果）：\n" +
        priorOutline,
    );
  }
  if (continueFromChapter >= 1) {
    parts.push(
      `（接续：上一段最后处理到第 ${continueFromChapter} 章；本片段开头可能是该章的尾部，无需重复处理，` +
        `从第 ${continueFromChapter + 1} 章起提交。）`,
    );
  }
  parts.push("本次需要处理的小说原文片段：\n" + excerpt);
  return parts.join("\n\n");
}

/**
 * Mark every source chapter's outline as `"skipped"` without invoking the agent.
 * Used for INTERNET novels (pre-chaptered by the source site — no splitting
 * needed, so no LLM pass). The scheduler's `needsWork` treats "skipped" as
 * "outline ready" and proceeds to rewrite ungated. Idempotent — chapters that
 * already have a terminal-status row are left alone.
 *
 * Note: file novels (including nonNovelSource) NO LONGER take this path — they
 * always run `generateOutlines`, because splitting now requires the LLM (the
 * regex chapterParser is gone). `skipOutlines` is internet-only.
 */
export function skipOutlines(threadId: string): void {
  const sources = entertainmentService.listSourceChapters(threadId);
  const existing = new Set(
    entertainmentService.listOutlines(threadId).map((o) => o.chapterNumber),
  );
  for (const s of sources) {
    if (!existing.has(s.chapterNumber)) {
      entertainmentService.insertOutline({
        threadId,
        chapterNumber: s.chapterNumber,
        status: "skipped",
      });
    }
  }
}
