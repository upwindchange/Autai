import { streamText, stepCountIs, tool } from "ai";
import { z } from "zod";
import log from "electron-log/main";
import {
  complexModel,
  forwardSamplingParams,
  reasoningProviderOptions,
} from "@agents/providers";
import { hasSuccessfulToolResult, TIMEOUTS } from "@agents/utils";
import { settingsService, entertainmentService } from "@/services";
import type {
  DehydrateBasic,
  DehydrateConfig,
  DehydrateDepth,
  SituationCategory,
  SituationTactics,
} from "@shared";
import { SITUATION_CATEGORIES } from "@shared";

const logger = log.scope("Dehydrate:Rewriter");

/** Terminal status the rewrite agent reports back to the scheduler. */
export type RewriteOutcome = "rewritten" | "error";

/**
 * `outputProcessedContent` — the rewrite agent's terminal tool and the ONLY way
 * it delivers the result. The agent calls it once with the fully rewritten
 * chapter prose; execute writes that prose + the `"rewritten"` status to
 * `rewritten_chapters(N)` in one shot, and `hasSuccessfulToolResult` then stops
 * the stream — so this single tool call both persists the result and terminates
 * the agent. `threadId` / `chapterNumber` arrive via `experimental_context`
 * (zero-token — never in the prompt). Named as an output verb so the model
 * reads it as "this is how I hand back the rewritten text", not a side-effect
 * save it might skip in favor of plain-text output.
 */
const outputProcessedContentTool = tool({
  description:
    "The ONLY way to end your output and deliver the rewritten content — " +
    "call this outputProcessedContent tool with the full rewritten prose as `content`. " +
    "You are NOT ALLOWED output the prose as plain text and stop your output; " +
    "it must go through this outputProcessedContent tool.",
  inputSchema: z.object({
    content: z
      .string()
      .min(1)
      .describe("The full rewritten chapter content, content only."),
  }),
  execute: async (input, { experimental_context }) => {
    const ctx = experimental_context as {
      threadId: string;
      chapterNumber: number;
    };
    entertainmentService.updateRewrittenChapter(
      ctx.threadId,
      ctx.chapterNumber,
      {
        content: input.content,
        status: "rewritten",
      },
    );
    logger.info("processed content output", {
      threadId: ctx.threadId,
      chapterNumber: ctx.chapterNumber,
      contentLen: input.content.length,
    });
    return { saved: true };
  },
});

/**
 * Reinforcement appended to the system prompt on the one-shot retry when the
 * agent stopped without calling `outputProcessedContent`. Tells the model
 * plainly why its first attempt was rejected (plain-text output is discarded)
 * and that it must hand the prose back through the tool.
 */
const RETRY_SUFFIX = `

## ⚠ Your previous submission was invalid — you must resubmit through the tool
Your last response did not call the outputProcessedContent tool; \
instead, you stopped after emitting plain text. \
Plain text is not accepted, so the result is invalid. \
Please resubmit now: call the outputProcessedContent tool \
and place the full rewritten prose in the content parameter. \
Do not output plain text, \
and do not write any prose outside of the tool call.`;

/**
 * Run one rewrite-agent pass under `systemPrompt`. Returns whether the agent
 * called `outputProcessedContent` (the tool's execute already wrote the result
 * to the DB on success). Forced `toolChoice` + `hasSuccessfulToolResult` make
 * the tool call the agent's terminal step; some models still ignore the forced
 * tool and stop on plain text — that's recovered by the caller's one-shot retry
 * with `RETRY_SUFFIX`, not by this helper.
 */
async function runRewriteAgent(
  systemPrompt: string,
  sourceText: string,
  threadId: string,
  chapterNumber: number,
  signal?: AbortSignal,
): Promise<boolean> {
  const resolved = complexModel();
  const sampling = forwardSamplingParams(resolved.params);
  const reasoning = reasoningProviderOptions(
    resolved.params,
    resolved.model,
    resolved.npm,
  );
  const result = streamText({
    model: resolved.model,
    system: systemPrompt,
    messages: [{ role: "user", content: sourceText }],
    tools: {
      outputProcessedContent: outputProcessedContentTool,
    },
    toolChoice: { type: "tool", toolName: "outputProcessedContent" },
    stopWhen: [
      hasSuccessfulToolResult("outputProcessedContent"),
      stepCountIs(3),
    ],
    maxRetries: settingsService.settings.maxRetries,
    timeout: TIMEOUTS.novel,
    abortSignal: signal,
    ...sampling,
    ...(reasoning && { providerOptions: reasoning }),
    experimental_context: { threadId, chapterNumber },
    experimental_telemetry: {
      isEnabled: settingsService.settings.langfuse.enabled,
      functionId: "entertainment-rewriter",
      metadata: { threadId, chapterNumber },
    },
  });
  const steps = await result.steps;
  return steps
    .flatMap((s) => s.toolResults ?? [])
    .some(
      (tr) =>
        tr.toolName === "outputProcessedContent" && tr.type === "tool-result",
    );
}

/**
 * Rewrite one chapter's 原文 → 重写 via a single-shot agent. Owns its own
 * `rewritten_chapters` row lifecycle end to end: marks `"rewriting"` up front,
 * runs the agent under the constructed system prompt (whose output contract
 * requires delivering the prose via `outputProcessedContent`, never as plain
 * text), and the tool dumps the rewritten prose + the `"rewritten"` status to
 * the DB. If the agent ignores the forced tool and stops on plain text, one
 * retry runs with a reinforced prompt (`RETRY_SUFFIX`) explaining the failure.
 * On a second failure or a hard error the row is marked `"error"`. Returns the
 * terminal status so the scheduler can branch without touching the DB itself.
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
  const existing = entertainmentService.getRewrittenChapter(
    threadId,
    chapterNumber,
  );
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
    entertainmentService.getSourceChapter(threadId, chapterNumber)?.content ??
    "";

  logger.info("rewriting", {
    threadId,
    chapterNumber,
    sourceLen: sourceText.length,
  });

  const basePrompt = buildRewriteSystemPrompt(options);
  try {
    let saved = await runRewriteAgent(
      basePrompt,
      sourceText,
      threadId,
      chapterNumber,
      signal,
    );
    if (!saved) {
      // The agent stopped without calling the tool (typical: it streamed prose
      // as plain text). Reinforce the ending condition and retry once.
      logger.warn(
        "rewrite stopped without outputProcessedContent; retrying once",
        {
          threadId,
          chapterNumber,
        },
      );
      saved = await runRewriteAgent(
        `${basePrompt}${RETRY_SUFFIX}`,
        sourceText,
        threadId,
        chapterNumber,
        signal,
      );
    }
    if (saved) {
      entertainmentService.touchThread(threadId);
      logger.info("chapter rewritten", { threadId, chapterNumber });
      return "rewritten";
    }
    logger.error("rewrite ended without calling outputProcessedContent", {
      threadId,
      chapterNumber,
    });
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
const BASIC_ORDER: (keyof DehydrateBasic)[] = ["grammarFix", "webSlangFilter"];

const BASIC_RULES: Record<keyof DehydrateBasic, string> = {
  grammarFix:
    "错别字、病句、标点：修正错别字与语病；中文文本里混入的日语、英语标点一律改成中文标点；补齐单边引号、括号等残缺配对。",
  webSlangFilter:
    "烂词与反和谐：清理“倒吸一口凉气”“嘴角勾起一抹冷笑”之类被用烂的套话；还原被标点打码的字词，写出本来的写法。",
};

// ---------------------------------------------------------------------------
// Situational filler-stripping rules (情境脱水).
//
// One entry per individual tactic in `SituationTactics` (the 85 sub-tactics from
// situation.md). Each entry holds the tactic's Chinese label plus a `rule` that
// only identifies the 套路 and the purge direction within it (what's filler vs.
// what's the valuable core) — never HOW to purge or to what EXTENT, which is the
// strength dial's job alone. `SITUATION_TACTICS` is
// `Record<keyof SituationTactics, …>`, so a new tactic in the schema surfaces
// here as a missing-key error. `SITUATION_CATEGORY_LABELS` names the 16 groups
// for the prompt; grouping/order comes from `SITUATION_CATEGORIES` (shared).
// Injected by `buildRewriteSystemPrompt` only for the tactics the user enabled.
// ---------------------------------------------------------------------------

const SITUATION_CATEGORY_LABELS: Record<SituationCategory, string> = {
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
 * 脱水提速 strength dial — the on/off + intensity control for 情境脱水, and the
 * SINGLE source of truth for how deep the purge goes. 0 = off → no situational
 * 脱水 at all (the whole block is omitted from the prompt, regardless of which
 * tactics are checked); 1/2/3 = light/medium/heavy, the intensity applied to the
 * checked tactics. The prompt lists ALL THREE levels (so the model has a
 * calibrated sense of the dial), then names and reprints the chosen one. The
 * situation tactics themselves never encode depth — only this dial does, so the
 * three concerns (direction / depth / which套路) never conflict. Level text is
 * kept here (not in DEPTH_ASPECTS, which no longer has a `dehydrate` entry).
 */
const SITUATION_STRENGTH_LEVELS: Record<1 | 2 | 3, string> = {
  1: "只删明显重复的与明显水字数的内容，不删除内容走向和基本剧情。",
  2: "精炼水字数的剧情，保留但是显著加快内容，使描写更加精炼，显著提升阅读体验。",
  3: "完全删除有水字数特性的内容，把被删除的剧情高度精炼概括，概括越短越好。",
};

const SITUATION_TACTICS: Record<
  keyof SituationTactics,
  { label: string; rule: string }
> = {
  mobGrinding: {
    label: "打小怪/杂兵/分身",
    rule:
      "连续打小怪、杂兵、丧尸、虫族、魔物、刺客等段落。其中只换名字颜色等级的同质敌人、重复的招式和重复的收割过程" +
      "，是水；首次展示威胁、获得关键资源、暴露新能力、引出大敌或造成消耗的战斗，才是有效信息。",
  },
  combatFrameByFrame: {
    label: "战斗拆帧描写",
    rule:
      "一个动作被拆成过多步骤（抬手、凝气、眼神一冷、衣袍猎猎、空气震颤、瞳孔收缩、众人色变……）" +
      "。其中模板化的拆帧描写，是水；能体现实力差距、战术选择、人物情绪或新招式效果的关键细节，才是有效信息。",
  },
  skillNameSpam: {
    label: "招式名/技能说明刷屏",
    rule:
      "招式名、技能名、功法名反复出现并附带说明。其中名称刷屏、与当前局势无关的历史来历/前人传说/冗长等级解释" +
      "，是水；首次出现的名称与核心效果，以及当前战斗必须知道的能力、代价与限制，才是有效信息。",
  },
  powerLevelLecture: {
    label: "战力等级科普",
    rule:
      "战力等级、境界体系、职业体系、机甲等级、异能等级等设定说明。其中重复科普同一体系、长篇解释读者已知的层级" +
      "，是水；读者理解当前冲突所需的信息，以及当前人物所处层级与主角的差距，才是有效信息。",
  },
  fakeDisadvantage: {
    label: "“看似逆风”的假紧张",
    rule:
      "主角明有底牌却反复被制造“看似逆风”。其中“被压制—众人担心—反派得意—主角微笑”这一流程的反复套用" +
      "，是水；真正有风险、有代价或策略有变化的部分，以及反转本身，才是有效信息。",
  },
  crowdShock: {
    label: "围观群众震惊",
    rule:
      "围观群众震惊。其中连续的“倒吸凉气”“全场死寂”“怎么可能”、多人的同质反应" +
      "，是水；能反衬主角实力、揭示常识差距或推动舆论变化的反应，才是有效信息。",
  },
  bystanderExposition: {
    label: "路人解说",
    rule:
      "路人通过对话解释背景。其中“你不知道？此人可是……”式广播腔" +
      "、让路人承担百科全书功能的段落，是水；当前剧情必须知道的背景信息，才是有效信息。",
  },
  groupPsychology: {
    label: "群体心理描写",
    rule:
      "“所有人都觉得……”式群体心理描写。其中多次重复同一种看法、对无人会据此行动的群体心理做大段展开" +
      "，是水；群体判断的核心结论，以及会导致具体人物采取行动的误判，才是有效信息。",
  },
  danmakuSpam: {
    label: "弹幕/评论区/论坛体",
    rule:
      "弹幕、评论区、论坛、热搜评论。其中刷屏式的重复评论、半章相同的情绪" +
      "，是水；能体现舆论转折、阵营冲突或爽点反馈的少数几条，才是有效信息。",
  },
  mediaReports: {
    label: "新闻报道/媒体通稿",
    rule:
      "新闻报道、媒体通稿、营销号文章。其中“据业内人士透露”“专家表示”等空泛内容" +
      "，是水；对剧情有影响的标题、结论或舆论后果，才是有效信息。",
  },
  worldbuildingEncyclopedia: {
    label: "世界观百科",
    rule:
      "世界观、地图、势力、星域、宗门、贵族、科技树等百科式说明。其中当前剧情不需要的历史" +
      "、地理、等级、势力关系，是水；当前行动马上会接触到的设定，才是有效信息。",
  },
  itemProfiles: {
    label: "物品/宝物介绍",
    rule:
      "丹药、法宝、神兵、礼服、珠宝、机甲等物品介绍。其中与当前剧情无关的产地、传说、工艺、参数" +
      "，以及逐件详写的拍卖品/道具，是水；物品的名称、当前用途、稀缺性，以及会造成的冲突，才是有效信息。",
  },
  mapTours: {
    label: "地图介绍",
    rule:
      "新城市、新宗门、新星球、新基地等地图介绍。其中纯观光式的街景" +
      "、历史和风土人情，是水；主角马上会接触到的地点、势力和危险，才是有效信息。",
  },
  genealogy: {
    label: "家族/宗门谱系",
    rule:
      "家族、宗门、朝堂、公司内部谱系介绍。其中一次性罗列所有长老、亲戚、派系" +
      "，以及未在本章行动人物的完整背景，是水；当前冲突涉及的人物关系，才是有效信息。",
  },
  cultivationRoutine: {
    label: "功法修炼过程",
    rule:
      "闭关修炼、运转功法、冲击境界等描写。其中每次都重复的灵气入体、经脉游走、丹田震动等模板句" +
      "，是水；新功法、新瓶颈、新风险，以及突破的关键难点与代价，才是有效信息。",
  },
  systemPanels: {
    label: "系统/属性面板",
    rule:
      "系统面板、属性面板、数据面板。其中完整重复的面板、不影响后续行动的数值罗列" +
      "，是水；发生变化且会影响后续行动的项目，才是有效信息。",
  },
  gachaCheckin: {
    label: "抽奖/签到/开盲盒",
    rule:
      "抽奖、签到、开盲盒等桥段。其中无效抽取、系统废话、重复的“叮”“金光一闪”“恭喜宿主”" +
      "，是水；关键奖励、失败代价、主角反应，以及奖励对后续剧情的影响，才是有效信息。",
  },
  innerMonologueLoop: {
    label: "内心戏反复横跳",
    rule:
      "角色内心反复纠结。其中“他是不是喜欢我—不可能—可是……”式原地打转的循环" +
      "，是水；最终产生决定、误判、行动或关系变化的那个心理结论，才是有效信息。",
  },
  outfitDescriptions: {
    label: "换装/妆造描写",
    rule:
      "换装、礼服、妆容、珠宝描写。其中从头到脚的材质、颜色、品牌堆砌，是水；最有辨识度的两三个细节" +
      "，以及它造成的社交效果（身份变化、情绪状态或打脸场景），才是有效信息。",
  },
  banquetFiller: {
    label: "宴会/舞会/宫宴",
    rule:
      "宴会、舞会、宫宴等社交场景。其中入场顺序、寒暄、献艺、送礼等流程的流水账" +
      "，是水；核心冲突、人物试探、身份揭露和关系变化，才是有效信息。",
  },
  appearanceRedescription: {
    label: "主角外貌反复描写",
    rule:
      "男主或女主外貌反复描写。其中每次出场都从眉眼、唇色、气场、身材重新描写的段落" +
      "，是水；首次出场的鲜明形象，以及能体现当下状态的外貌变化，才是有效信息。",
  },
  villainMockery: {
    label: "反派嘲讽铺垫",
    rule:
      "反派嘲讽、路人跟嘲、亲戚跟嘲。其中连续重复的羞辱，是水" +
      "；最能代表冲突立场的核心嘲讽，以及它导向的主角亮牌或反击，才是有效信息。",
  },
  narratedConspiracy: {
    label: "阴谋计划全程旁白",
    rule:
      "反派密谋的全程旁白。其中完整剧透所有计划、提前说明必败流程，是水" +
      "；关键动机、目标，以及能在后文通过行动揭示的一两个危险步骤，才是有效信息。",
  },
  trialReveal: {
    label: "审判/揭穿/对质场景",
    rule:
      "审判、揭穿、对质、人证物证反转。其中重复的证词、无效争辩、被无意义打断多次的真相" +
      "，是水；误导证据—关键反转—决定性证据这一核心链条，才是有效信息。",
  },
  mealDescriptions: {
    label: "吃饭描写",
    rule:
      "吃饭、做菜、美食描写（非美食主线）。其中完整的烹饪流程和重复的口感描述，是水；菜品带来的关系变化" +
      "、资源展示或情绪缓和，才是有效信息。（美食文里每道菜若有新意或剧情作用，则属有效信息。）",
  },
  travelFiller: {
    label: "赶路/旅行",
    rule:
      "赶路、旅行、迁徙。其中重复的路况、天气、住宿和闲聊，是水" +
      "；途中遭遇、地图信息、人物互动或危机伏笔，才是有效信息。",
  },
  shoppingFiller: {
    label: "逛街/购物",
    rule:
      "逛街、购物、买衣服、买车买房等消费桥段。其中商品列表、重复的柜员看不起、逐店循环的消费打脸" +
      "，是水；会引发冲突、展示身份、改变资源或推动关系的购买行为，才是有效信息。",
  },
  trainingStudy: {
    label: "训练/学习过程",
    rule:
      "训练、学习、讲课、练习。其中教学细节和重复失败的机械刷熟练度，是水" +
      "；主角的理解难点、突破方法、能力变化和他人反应，才是有效信息。",
  },
  circularArguments: {
    label: "车轱辘话",
    rule:
      "人物反复争论同一件事（“你不能去/我必须去”式）。其中没有信息增量的重复立场" +
      "，是水；第一次明确冲突、一次情绪升级和最终决定，才是有效信息。",
  },
  leadingQuestions: {
    label: "明知故问式对话",
    rule:
      "角色用提问引出设定说明（“难道就是传说中……”式套路）。其中伪装成对话的设定科普" +
      "，是水；符合角色知识水平和当下情境的自然对话或简短旁白，才是有效信息。",
  },
  rollCallStatements: {
    label: "多人轮流表态",
    rule:
      "会议、朝堂、宗门议事、董事会中多人轮流表态。其中每个相同阵营的人都各讲一遍" +
      "、主角发言前的过长铺垫，是水；代表赞成、反对、中立和关键反转的人物发言，才是有效信息。",
  },
  repeatedConfirmations: {
    label: "重复确认信息",
    rule:
      "“真的吗”“怎么可能”“你再说一遍”等重复确认" +
      "。其中多轮的震惊式确认，是水；信息本身的一句清楚陈述，才是有效信息。",
  },
  flashbacks: {
    label: "回忆杀",
    rule:
      "回忆、前世、童年、旧案、往事。其中完整流水账式的回忆" +
      "，是水；解释当前选择或冲突所需的片段，才是有效信息。",
  },
  hiddenPowerLoops: {
    label: "反复“隐藏实力”",
    rule:
      "主角隐藏实力被看轻再震惊全场的循环。其中每换地图都完整重演的“被看轻—出手—震惊”流程，是水" +
      "；最有代表性的一次铺垫和爆发，以及出现新身份风险、新敌人判断或新代价时的转折，才是有效信息。",
  },
  rankingBoards: {
    label: "阶段性排行榜",
    rule:
      "天骄榜、财富榜、战力榜等阶段性排行榜。其中完整榜单的逐名罗列、大量路人讨论，是水" +
      "；与主角、核心对手和资源分配有关的排名，以及榜单制造的目标、压力或反转，才是有效信息。",
  },
  rewardSettlement: {
    label: "奖励结算",
    rule:
      "积分、排名、成就、投票、粉丝、商业价值等奖励结算。其中UI式逐项罗列" +
      "，是水；变化最大的项目，以及对后续行动有用的奖励，才是有效信息。",
  },
  ceoControlMinutiae: {
    label: "霸总日常控制细节",
    rule:
      "霸总安排司机、衣服、饮食、保镖、查行踪、买楼买店等桥段。其中无后果的控制性日常" +
      "、原地暧昧的互动，是水；能体现关系张力、权力冲突或人物改变的细节，才是有效信息。",
  },
  cuteBabyAssist: {
    label: "带娃/萌宝助攻",
    rule:
      "萌宝卖萌、撮合、装病、天才技能打脸等桥段。其中单纯可爱但无剧情推进的互动" +
      "，是水；能推动亲子关系、男女主关系或身份真相的内容，才是有效信息。",
  },
  treasureAppraisal: {
    label: "捡漏/鉴宝",
    rule:
      "捡漏、鉴宝、赌石、古玩、灵石等桥段。其中市场闲逛、老板忽悠、路人嘲笑的重复流程，是水" +
      "；误判、主角识破玄机、低价获得、价值揭晓，以及每次捡漏的新机制或新后果，才是有效信息。",
  },
  medicalRescue: {
    label: "医术救人",
    rule:
      "神医救人。其中家属不信、名医质疑、针法解释等重复环节，是水" +
      "；病情危机、主角判断、关键治疗动作和治疗后果，才是有效信息。",
  },
  techSpecs: {
    label: "科技参数说明",
    rule:
      "飞船、机甲、武器、AI、基因、能源等科技参数。其中炫技式术语和无关型号说明" +
      "，是水；影响剧情选择、战斗胜负或世界规则的参数，才是有效信息。",
  },
  apocalypseSupplies: {
    label: "末世物资清单",
    rule:
      "末世囤货、物资清单。其中米面粮油药品工具的长列表，是水；关键稀缺物资和会影响生存策略的资源" +
      "，才是有效信息。",
  },
  instanceRules: {
    label: "副本规则说明",
    rule:
      "无限流副本规则、禁忌、通关条件。其中完整条款式说明，是水" +
      "；玩家马上会用到或违反会出事的规则，才是有效信息。",
  },
  actingAudition: {
    label: "娱乐圈试镜/拍戏",
    rule:
      "试镜、拍戏、剧本理解、导演质疑、演员挑衅。其中完整戏中戏和重复惊艳反应" +
      "，是水；角色难点、主角表演突破和行业后果，才是有效信息。",
  },
  chapterRecap: {
    label: "重复上一章内容",
    rule:
      "新章开头复述上一章内容。其中重复敌人多强、众人多震惊、主角处境多危险" +
      "，是水；读者理解当前场景所必需的复述，才是有效信息。",
  },
  forcedCliffhanger: {
    label: "章节末尾强行悬念",
    rule:
      "章节末尾强行悬念。其中空泛的“真正的危机才刚刚开始”，是水" +
      "；给出具体新信号（人物、物品、声音、证据或危险来源）的悬念，才是有效信息。",
  },
  synonymStacking: {
    label: "同义句堆叠",
    rule:
      "连续三句表达同一情绪或结论（“他很愤怒、前所未有的愤怒、怒火焚烧理智”）。其中同义递进的重复" +
      "，是水；一句最有力量的表达（除非语言本身承担强烈风格作用），才是有效信息。",
  },
  adjectivePiling: {
    label: "形容词连打",
    rule:
      "形容词堆砌（冰冷、恐怖、森然、压抑、令人窒息）。其中同质词连用，是水" +
      "；最准确的一两个词，以及用具体动作或结果替代空泛形容，才是有效信息。",
  },
  atmosphereRedressing: {
    label: "反复描写环境气氛",
    rule:
      "天色、风声、烛火、空气凝固、杀意弥漫等气氛描写。其中不影响人物行动" +
      "、判断或情绪的环境描写，是水；能增强当前冲突的气氛细节，才是有效信息。",
  },
  numberPiling: {
    label: "数字化堆砌",
    rule:
      "三十六道工序、九十九座山峰、七十二势力、十万大军等数字堆砌" +
      "。其中为了显得宏大的空泛数量，是水；真正影响规模、难度或选择的数字，才是有效信息。",
  },
  waitingForResults: {
    label: "“等待结果”",
    rule:
      "等待检测、榜单、判定、医生、系统结算、传承认可等结果。其中等待期间的大量心理活动和群众讨论" +
      "，是水；等待造成的压力、误导或关系变化，以及结果本身，才是有效信息。",
  },
};

const DEPTH_ORDER: (keyof DehydrateDepth)[] = [
  "dialoguePacing",
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
 * 情境脱水 → 重写强度 → 语言与翻译 → 自定义指令 → output contract. Optional
 * sections appear only when they have something to say.
 */
export function buildRewriteSystemPrompt(
  options: DehydrateConfig["options"],
): string {
  const { basic, situation, depth, language, customInstruction } = options;
  const sections: string[] = [];

  // Role + goal (always on) — gives the brief its voice and purpose.
  sections.push(
    "你是一名资深的中文小说重写编辑。你的任务是把给定的一章原文，重写成阅读体验显著更好的版本——同一个故事，换一种更好的讲法。",
  );

  // Core invariants (always on) — the "do not break" bottom line.
  sections.push(
    "无论后续如何改写，以下底线始终不可破坏：\n" +
      "- 剧情、人物、设定与关键信息一律保留：不增删情节、不改写事实，你改的是“怎么写”，不是“写了什么”。\n" +
      "- 守住本章的边界与视角：不要补写前后章节的内容，不要擅自续写或收尾。\n" +
      "- 保留对话的信息量与潜台词：只在表达层面优化，不要让人物说出原本没说过的话。",
  );

  // 基础清洗 — one bullet per enabled toggle; all-off → section omitted.
  const basicRules = BASIC_ORDER.filter((k) => basic[k]).map(
    (k) => `- ${BASIC_RULES[k]}`,
  );
  if (basicRules.length) {
    sections.push(["基础清洗：", ...basicRules].join("\n"));
  }

  // 情境脱水 — situational filler-stripping. `situation.strength` is the
  // on/off + intensity control. 0 (off) → the WHOLE feature is skipped: no
  // situational block (not even the framing) appears, regardless of which
  // tactics are checked. 1/2/3 → the checked tactics are handled at that
  // intensity.
  //
  // Prompt design — three cleanly separated concerns, so they never conflict:
  //   1. General direction: the脱水 philosophy (what counts as effective info
  //      to keep vs. what counts as filler), plus the explicit hand-off that
  //      purge DEPTH is governed solely by the strength dial below.
  //   2. Strength dial (SITUATION_STRENGTH_LEVELS): the SINGLE source of truth
  //      for how deep the purge goes. All three levels are listed so the model
  //      has a calibrated sense of the dial, then the chosen level is named and
  //      its description reprinted so the active strength is unambiguous.
  //   3. Situation tactics (SITUATION_TACTICS): each only identifies a 套路 and
  //      the direction of purging within it (what's filler vs. what's the
  //      valuable core). They deliberately say NOTHING about HOW to purge or to
  //      what EXTENT — that is the strength dial's job alone.
  const situationBlocks: string[] = [];
  for (const cat of SITUATION_CATEGORIES) {
    const on = cat.tactics.filter((k) => situation.tactics[k]);
    if (!on.length) continue;
    const items = on.map(
      (k) => `  · ${SITUATION_TACTICS[k].label}：${SITUATION_TACTICS[k].rule}`,
    );
    situationBlocks.push(
      `- ${SITUATION_CATEGORY_LABELS[cat.key]}：\n${items.join("\n")}`,
    );
  }
  if (situation.strength > 0 && situationBlocks.length) {
    const lvl = situation.strength as 1 | 2 | 3;
    sections.push(
      [
        "情境脱水——针对网文常见的「水字数」套路做压缩。" +
          "底层只有一条原则：凡推动主线的新事件、改变人物关系的新互动、展现人物性格的新行为、" +
          "引出冲突的新信息、不可逆的选择，以及必要的爽点、情绪爆发、反转与伏笔，都属有效信息，一律保留。" +
          "判断每一段去留的唯一标准是——它是否为读者提供了新的信息或新的情绪推进。",
        "至于压缩到什么程度、删到什么深度，完全由下面的「脱水提速强度」决定：不要自行拿捏力度，也不要自行发明压缩方法。",
        "脱水提速强度（本次压缩深度的唯一标尺，严格按所选力度执行，既不要加码也不要打折）：\n" +
          `· 轻：${SITUATION_STRENGTH_LEVELS[1]}\n` +
          `· 中：${SITUATION_STRENGTH_LEVELS[2]}\n` +
          `· 重：${SITUATION_STRENGTH_LEVELS[3]}\n` +
          `➤ 本次选用「${LEVEL_LABEL[lvl]}」度脱水。\n` +
          `➤ 本次所选力度的执行口径（请严格照此执行）：${SITUATION_STRENGTH_LEVELS[lvl]}`,
        "下面是你勾选、需要识别并处理的具体情境套路。" +
          "每条只说明「这是什么套路、其中哪些是水、哪些才是有效信息」，作为你识别与判断的依据；" +
          "遇到后压缩或删除到什么程度，一律套用上方所选强度。",
        ...situationBlocks,
        "以上情境，只在原文确实出现、且属于上述套路的段落上按本次所选强度执行；不涉及的段落不要强行改写。",
      ].join("\n\n"),
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
        "打磨文笔：每项都已指明本次采用的强度——请严格按指明的力度执行，既不要自行加码，也不要打折",
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

  // Output contract (always on) — closes the brief. Demands the result be
  // delivered via the outputProcessedContent tool, never as plain text (plain
  // text would conflict with the forced tool call and be discarded).
  sections.push(
    "The only thing you are allowed to do is to call the outputProcessedContent tool:\n" +
      "- Place the full rewritten content in the tool's `content` parameter;\n" +
      "- You are not alowed to output rewritten content anywhere else " +
      "other than outputProcessedContent tool;\n" +
      "- You are not allowed to output anything other than " +
      "calling outputProcessedContent tool\n" +
      "- `content` must contain only the prose itself: " +
      "no explanations, asides, or preambles/postscripts, " +
      "and do not repeat the chapter title or the original text;\n" +
      "- Do not use Markdown headings or code blocks; " +
      "preserve sensible paragraph breaks;\n" +
      "- Unless translation or localization is explicitly requested, " +
      "keep the output language the same as the source;\n" +
      "- Do not emit the prose as plain text — " +
      "it must be submitted through the outputProcessedContent tool; " +
      "this is the only way to deliver the result.\n" +
      "- Emitting plain text without calling outputProcessedContent tool " +
      "will result in fatal failure",
  );

  return sections.join("\n\n");
}
