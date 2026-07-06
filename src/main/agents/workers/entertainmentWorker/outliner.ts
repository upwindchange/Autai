import { streamText, stepCountIs, tool } from "ai";
import { z } from "zod";
import log from "electron-log/main";
import { complexModel, complexModelContextWindow } from "@agents/providers";
import { hasSuccessfulToolResult, TIMEOUTS } from "@agents/utils";
import { settingsService, entertainmentService } from "@/services";
import type {
  CrossChapterCategory,
  CrossChapterDehydrate,
  CrossChapterTactics,
} from "@shared";
import { CROSS_CHAPTER_CATEGORIES } from "@shared";
import { OutlineBatchPlanner } from "./outlineBatcher";
import { compressPriorOutline } from "./outlineCompressor";

const logger = log.scope("Dehydrate:Outliner");

/**
 * Progress callback — fired once per chapter whose outline just landed. The
 * scheduler uses this to enqueue that chapter's rewrite the moment its outline
 * is ready, so rewriting does NOT wait for the whole book's outlines.
 */
export type OnChapterOutlined = (chapterNumber: number) => void;

/**
 * `outputOutlines` — the outliner agent's terminal tool and the ONLY way it
 * delivers its result. The agent calls it once per batch with one entry per
 * chapter it read in that batch; execute writes each entry to
 * `chapter_outlines(N)` and flips its status to `"outlined"`. Because the batch
 * is the unit of LLM work, one tool call persists multiple rows; the scheduler
 * learns of each via the caller's per-chapter progress callback.
 *
 * `threadId` arrives via `experimental_context` (zero-token — never in the
 * prompt). Named as an output verb so the model reads it as "this is how I hand
 * back the outlines", not a side-effect save it might skip.
 */
/**
 * The `outputOutlines` tool's description, extracted so the batch planner can
 * token-count it (the SDK injects this + the JSON schema as additional system
 * context, which counts against the window but isn't in the prompt string).
 */
const OUTPUT_OUTLINES_TOOL_DESCRIPTION =
  "The ONLY way to end your output and deliver the outlines — " +
  "call this outputOutlines tool with one entry per chapter you were given, " +
  "each carrying its chapterNumber, outline, foreshadowing, and needsCrossWrite. " +
  "You are NOT ALLOWED to output the outlines as plain text and stop your output; " +
  "they must go through this outputOutlines tool.";

const outputOutlinesTool = tool({
  description: OUTPUT_OUTLINES_TOOL_DESCRIPTION,
  inputSchema: z.object({
    outlines: z
      .array(
        z.object({
          chapterNumber: z.number().int(),
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
    const ctx = experimental_context as { threadId: string };
    let saved = 0;
    for (const o of input.outlines) {
      entertainmentService.updateOutline(ctx.threadId, o.chapterNumber, {
        outline: o.outline,
        foreshadowing: JSON.stringify(o.foreshadowing),
        needsCrossWrite: o.needsCrossWrite,
        status: "outlined",
      });
      saved++;
    }
    logger.debug("outlines output", {
      threadId: ctx.threadId,
      count: saved,
      chapters: input.outlines.map((o) => o.chapterNumber),
      needsCrossWrite: input.outlines
        .filter((o) => o.needsCrossWrite)
        .map((o) => o.chapterNumber),
    });
    return { saved };
  },
});

/**
 * Reinforcement appended to the system prompt on the one-shot retry when the
 * agent stopped without calling `outputOutlines`. Mirrors the rewriter's retry.
 */
const RETRY_SUFFIX = `

## ⚠ Your previous submission was invalid — you must resubmit through the tool
Your last response did not call the outputOutlines tool; \
instead, you stopped after emitting plain text. \
Plain text is not accepted, so the result is invalid. \
Please resubmit now: call the outputOutlines tool \
with one entry per chapter you were given, each carrying chapterNumber, \
outline, foreshadowing, and needsCrossWrite. \
Do not output plain text, \
and do not write any outline content outside of the tool call.`;

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
 */
function buildOutlineSystemPrompt(crossChapter: CrossChapterDehydrate): string {
  const sections: string[] = [];

  // Role + goal (always on).
  sections.push(
    "你是一名资深的中文小说连载编辑。你的任务是阅读给定的一批章节原文，为每一章生成三样东西，" +
      "供后续的「章节并写」工序使用：",
  );

  // The three deliverables (always on).
  sections.push(
    "对每一章，请产出：\n" +
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
    "你会一次收到一批章节原文。如果你之前已经处理过更早的章节，本次输入会附带“前情大纲”" +
      "（之前每一章的大纲汇总）作为上下文，帮助你判断伏笔是否已埋、套路是否在重复。" +
      "请把前情大纲作为整体剧情的参照，但本次只需为“本次章节”这一批产出结果。",
  );

  // Output contract (always on, English, closes the brief).
  sections.push(
    "The only thing you are allowed to do is to call the outputOutlines tool:\n" +
      "- Place an array entry per chapter you were given, each carrying " +
      "chapterNumber, outline, foreshadowing (string array, may be empty), " +
      "and needsCrossWrite (boolean);\n" +
      "- You are not allowed to output outlines anywhere other than the " +
      "outputOutlines tool;\n" +
      "- You are not allowed to output anything other than calling the " +
      "outputOutlines tool;\n" +
      "- `outline` must be a brief factual summary: no explanations, asides, " +
      "or preambles; do not copy the original prose;\n" +
      "- `foreshadowing` entries are short keywords/noun phrases, not " +
      "sentences; only include things that genuinely matter later;\n" +
      "- Emitting plain text without calling the outputOutlines tool " +
      "will result in fatal failure.",
  );

  return sections.join("\n\n");
}

/**
 * Run one outliner-agent pass under `systemPrompt` for a single batch. Returns
 * whether the agent called `outputOutlines` (the tool's execute already wrote
 * the rows to the DB on success). The `userContent` carries the prior outlines
 * (cumulative context) + this batch's chapter原文, formatted as one message.
 */
async function runOutlineAgent(
  systemPrompt: string,
  userContent: string,
  threadId: string,
): Promise<boolean> {
  logger.debug("outliner agent batch start", {
    threadId,
    userContentLen: userContent.length,
  });
  const result = streamText({
    model: complexModel(),
    system: systemPrompt,
    messages: [{ role: "user", content: userContent }],
    tools: {
      outputOutlines: outputOutlinesTool,
    },
    toolChoice: { type: "tool", toolName: "outputOutlines" },
    stopWhen: [hasSuccessfulToolResult("outputOutlines"), stepCountIs(3)],
    maxRetries: settingsService.settings.maxRetries,
    timeout: TIMEOUTS.chat,
    experimental_context: { threadId },
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
      (tr) => tr.toolName === "outputOutlines" && tr.type === "tool-result",
    );
  const usage = await result.totalUsage;
  logger.debug("outliner agent batch done", {
    threadId,
    saved,
    steps: steps.length,
    inputTokens: usage?.inputTokens,
    outputTokens: usage?.outputTokens,
  });
  return saved;
}

// --- batch budgeting -------------------------------------------------------

/**
 * Conservative fallback when the model's context window can't be read from the
 * catalog (e.g. openai-compatible has no TOML). 128k matches a modern default
 * and keeps batches safe; callers that need more can configure the model.
 */
const FALLBACK_CONTEXT_TOKENS = 128_000;

// --- the public entry ------------------------------------------------------

/**
 * Generate outlines for every chapter of a file-uploaded novel. Owns the whole
 * `chapter_outlines` row lifecycle (mirrors `rewriteChapter`'s ownership of
 * rewrite rows). Resumable: a chapter counts as done ONLY if its row is
 * `status: "outlined"`; `outlining`/`error`/`skipped`/missing all mean "needs
 * (re)processing", so a crashed run picked back up continues from the first
 * unfinished chapter without re-processing completed ones.
 *
 *   1. Reconcile outline rows against source chapters. Skip chapters already
 *      `outlined`. For every other source chapter, insert an `outlining`
 *      placeholder (or reset a stale `error`/`skipped` row to `outlining`) so
 *      the scheduler's `needsWork` holds it back until its outline lands.
 *   2. If earlier chapters are already `outlined` (resume scenario), rebuild
 *      the cumulative prior outline from them via the compressor — the
 *      in-memory prior outline was lost on crash, so it's re-derived from the
 *      DB rows that did land.
 *   3. Loop the PENDING chapters in batches sized to the model's context
 *      window. Each batch's user message carries the cumulative prior outlines
 *      (so the agent can judge whether a beat is repeating or a clue was
 *      already planted) plus this batch's chapter原文.
 *   4. Per batch: run the agent (one-shot retry with `RETRY_SUFFIX` if it
 *      stopped without calling the tool). The tool's execute writes each
 *      chapter's row to `"outlined"`; the progress callback fires per chapter so
 *      the scheduler can enqueue rewriting chapter-by-chapter without waiting
 *      for the whole book.
 *   5. Any chapter still `"outlining"` after its batch's retry is marked
 *      `"error"` so it doesn't block rewriting forever (the scheduler treats
 *      `"error"` outlines as "ready, degrade to no-outline rewrite").
 *
 * `onChapterOutlined` is called once per chapter whose outline just landed, in
 * chapter order within each batch. The caller (scheduler) uses it to `ensure`
 * that chapter's rewrite.
 */
export async function generateOutlines(
  threadId: string,
  crossChapter: CrossChapterDehydrate,
  onChapterOutlined?: OnChapterOutlined,
): Promise<{ outlined: number; errored: number; skipped: number }> {
  const sources = entertainmentService.listSourceChapters(threadId);
  if (sources.length === 0) {
    logger.info("no source chapters; nothing to outline", { threadId });
    return { outlined: 0, errored: 0, skipped: 0 };
  }

  const systemPrompt = buildOutlineSystemPrompt(crossChapter);

  // 1) Reconcile outline rows against source chapters. A chapter counts as
  //    "done" ONLY if its outline row is `status: "outlined"` — `outlining`,
  //    `error`, `skipped`, or a missing row all mean "needs (re)processing".
  //    Pre-insert an `outlining` placeholder for any source chapter with no row
  //    or a non-`outlined` row, so the scheduler's `needsWork` holds it back
  //    until this run writes its outline. Already-`outlined` chapters are
  //    skipped entirely (no re-processing, no LLM cost) — this is the resume
  //    path after a crash.
  const existingRows = entertainmentService.listOutlines(threadId);
  const outlineByNum = new Map(
    existingRows.map((o) => [o.chapterNumber, o]),
  );
  const doneChapterNums: number[] = []; // already `outlined` — feed recovery
  let insertedPlaceholders = 0;
  let resetStale = 0;
  const pendingSources = sources.filter((s) => {
    const row = outlineByNum.get(s.chapterNumber);
    if (row?.status === "outlined") {
      doneChapterNums.push(s.chapterNumber);
      return false; // done — skip
    }
    // Not done: insert a fresh placeholder if no row, or reset a stale
    // non-`outlined` row (`error`/`skipped`/`outlining`) to `outlining`.
    if (!row) {
      entertainmentService.insertOutline({
        threadId,
        chapterNumber: s.chapterNumber,
        status: "outlining",
      });
      insertedPlaceholders++;
    } else if (row.status !== "outlining") {
      entertainmentService.updateOutline(threadId, s.chapterNumber, {
        status: "outlining",
      });
      resetStale++;
    }
    return true;
  });
  logger.info("outline reconcile", {
    threadId,
    total: sources.length,
    done: doneChapterNums.length,
    pending: pendingSources.length,
    insertedPlaceholders,
    resetStale,
  });

  if (pendingSources.length === 0) {
    logger.info("all chapters already outlined; nothing to do", {
      threadId,
      total: sources.length,
    });
    return { outlined: 0, errored: 0, skipped: 0 };
  }

  // 2) If earlier chapters are already outlined (resume scenario), rebuild the
  //    cumulative prior outline from them so the LLM has context for judging
  //    whether a beat is repeating or a clue was already planted. The prior
  //    outline was an in-memory field lost on crash; we re-derive it by feeding
  //    all done chapters' outlines through the compressor once.
  let initialPriorOutline: string | undefined;
  if (doneChapterNums.length > 0) {
    const doneOutlines = doneChapterNums.map(
      (n) => `第 ${n} 章：${outlineByNum.get(n)!.outline}`,
    );
    const recovered = await compressPriorOutline(threadId, doneOutlines);
    initialPriorOutline = recovered ?? doneOutlines.join("\n");
    logger.info("recovered prior outline from done chapters", {
      threadId,
      doneChapters: doneChapterNums.length,
      recovered: !!recovered,
      priorLen: initialPriorOutline.length,
    });
  }

  // 3) Batch loop using the planner. The planner sizes each batch to the
  //    model's context window (system + tools + cumulative prior outline all
  //    measured via gpt-tokenizer), and compresses the cumulative prior
  //    outline after each batch so it doesn't grow linearly. The loop itself
  //    stays linear: plan → run → absorb. Only pending chapters are fed.
  const maxContext = complexModelContextWindow() ?? FALLBACK_CONTEXT_TOKENS;
  const planner = await OutlineBatchPlanner.create({
    maxContext,
    systemPrompt,
    toolDescription: OUTPUT_OUTLINES_TOOL_DESCRIPTION,
    initialPriorOutline,
  });
  logger.info("outline run", {
    threadId,
    totalChapters: sources.length,
    pendingChapters: pendingSources.length,
    doneChapters: doneChapterNums.length,
    maxContext,
    crossChapterStrength: crossChapter.strength,
  });

  let outlined = 0;
  let errored = 0;
  let index = 0;
  while (index < pendingSources.length) {
    const batch = planner.planBatch(pendingSources, index);
    index = batch.nextIndex;
    const batchNums = batch.chapters.map((c) => c.chapterNumber);
    const userContent = planner.buildUserMessage(batch.chapters);

    // 3) Run the agent for this batch, with one retry on a plain-text miss.
    let saved = false;
    let retried = false;
    try {
      saved = await runOutlineAgent(systemPrompt, userContent, threadId);
      if (!saved) {
        retried = true;
        logger.warn("outliner did not call tool; retrying", {
          threadId,
          batch: batchNums,
          userContentLen: userContent.length,
        });
        saved = await runOutlineAgent(
          systemPrompt + RETRY_SUFFIX,
          userContent,
          threadId,
        );
        if (saved) {
          logger.info("outliner retry succeeded", {
            threadId,
            batch: batchNums,
          });
        }
      }
    } catch (err) {
      logger.error("outliner batch threw", {
        threadId,
        batch: batchNums,
        retried,
        err,
      });
    }

    if (saved) {
      // The tool already wrote each chapter's row to "outlined". Collect the
      // freshly-written outlines, fire the per-chapter progress callback, count
      // successes, then hand the new outlines to the planner for compression.
      const newOutlines: string[] = [];
      for (const n of batchNums) {
        const row = entertainmentService.getOutline(threadId, n);
        if (row && row.status === "outlined") {
          newOutlines.push(`第 ${n} 章：${row.outline}`);
          try {
            onChapterOutlined?.(n);
          } catch (cbErr) {
            logger.warn("onChapterOutlined callback threw", {
              threadId,
              chapterNumber: n,
              err: cbErr,
            });
          }
          outlined++;
        } else {
          // Tool reported saved but the row didn't land — mark error.
          logger.warn("outline row missing after tool reported saved", {
            threadId,
            chapterNumber: n,
            rowStatus: row?.status ?? "no row",
          });
          entertainmentService.updateOutline(threadId, n, { status: "error" });
          errored++;
        }
      }
      // Absorb + compress the cumulative prior outline for the next batch.
      if (newOutlines.length) {
        await planner.absorbOutlines(threadId, newOutlines);
      }
    } else {
      // Batch failed after retry — mark every chapter in it as error.
      for (const n of batchNums) {
        entertainmentService.updateOutline(threadId, n, { status: "error" });
        errored++;
      }
      logger.error("outliner batch failed after retry", {
        threadId,
        batch: batchNums,
      });
    }
  }

  logger.info("outline run complete", {
    threadId,
    outlined,
    errored,
    total: sources.length,
  });
  return { outlined, errored, skipped: 0 };
}

/**
 * Mark every source chapter's outline as `"skipped"` without invoking the agent.
 * Used when cross-chapter is unavailable (non-file novel, or the
 * `nonNovelSource` flag set) so the scheduler's `needsWork` treats them as
 * "outline ready" and proceeds to rewrite ungated. Idempotent — chapters that
 * already have a terminal-status row are left alone.
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
