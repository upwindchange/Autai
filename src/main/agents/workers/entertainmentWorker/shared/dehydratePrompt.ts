/**
 * Shared dehydrate system-prompt builder for the entertainment rewriter agents.
 *
 * Both rewrite agents — the chaptered-file one-pass runner (merge/re-chapter
 * dehydrate over a chunk) and the chaptered-internet single-chapter rewriter —
 * share the SAME option→prompt logic. The wizard options
 * (basic / situation / crossChapter / depth / language / customInstruction) all
 * feed one builder; the prompt body that translates them into instructions is
 * identical except for four variant-specific pieces:
 *
 *   1. The ROLE line — `multi` re-chapters + merges + dehydrates a chunk into N
 *      chapters; `single` rewrites one already-chaptered chapter in place.
 *   2. The CORE INVARIANTS — the chapter-boundary rule differs: `single` stays
 *      within this one chapter; `multi` may weld chapters together but not
 *      invent beyond the source material.
 *   3. The OUTPUT CONTRACT — `multi` must hand back an array of `{ title,
 *      content }` via the `outputChapters` tool; `single` must hand back a
 *      single `content` via the `outputProcessedContent` tool.
 *   4. The 脱水块 tactic sources — `single` uses only `situation.tactics`;
 *      `multi` merges `situation.tactics` + `crossChapter.tactics` into one
 *      array (cross-chapter 套路 need multi-chapter context, which only `multi`
 *      has).
 *
 * Everything else is built here, once, by injection: every enabled feature
 * contributes its piece, disabled features are silent (no "don't do X" noise).
 * See `buildDehydrateSystemPrompt(options, variant)`.
 *
 * Design philosophy (mirrors the wizard's UX): the per-tactic checkboxes under
 * 按情境脱水 / 章节并写 are OPTIONAL ENFORCEMENT — recommended OFF. The strength
 * dial alone drives intelligent dehydration; the prompt reflects this by
 * emitting the full situational philosophy + the chosen strength level even
 * when NO individual tactic is checked. Checked tactics only add extra
 * identification hints ("here's a 套路 to watch for"); when none are checked the
 * situational block still appears (strength-driven) but lists no tactics — a
 * clean, noise-free prompt. "Leave them all off" is the blessed default.
 */

import type {
  CrossChapterTactics,
  DehydrateBasic,
  DehydrateConfig,
  DehydrateDepth,
  SituationCategory,
  SituationTactics,
} from "@shared";
import { CROSS_CHAPTER_CATEGORIES, SITUATION_CATEGORIES } from "@shared";

// ---------------------------------------------------------------------------
// Level labels + emission orders
//
// Records are keyed by the schema types (`keyof DehydrateBasic`,
// `keyof DehydrateDepth`, `keyof SituationTactics`, `SituationCategory`) so a
// new toggle/aspect/tactic/category added to the schema surfaces here as a
// missing-key compile error rather than silently dropping out of the prompt.
// ---------------------------------------------------------------------------

const LEVEL_LABEL = { 1: "轻", 2: "中", 3: "重" } as const;

const BASIC_ORDER: (keyof DehydrateBasic)[] = ["grammarFix", "webSlangFilter"];

const BASIC_RULES: Record<keyof DehydrateBasic, string> = {
  grammarFix:
    "错别字、病句、标点：修正错别字与语病。中文文本里混入的日语、英语标点一律改成中文标点。" +
    "补齐单边引号、括号等残缺配对。还原被打码/和谐掉的字词。",
  webSlangFilter:
    "烂词与反和谐：把“倒吸一口凉气”、“嘴角勾起一抹冷笑”、“身体折成了凹字形向后飞去”之类被用烂的套话换一种方式重写。",
};

// ---------------------------------------------------------------------------
// Situational filler-stripping rules (情境脱水).
//
// One entry per individual tactic in `SituationTactics` (the single-chapter
// sub-tactics). Each entry holds the tactic's Chinese label plus a `rule` that
// only identifies the 套路 and the purge direction within it (what's filler vs.
// what's the valuable core) — never HOW to purge or to what EXTENT, which is the
// strength dial's job alone. `SITUATION_TACTICS` is
// `Record<keyof SituationTactics, …>`, so a new tactic in the schema surfaces
// here as a missing-key error. `SITUATION_CATEGORY_LABELS` names the groups for
// the prompt; grouping/order comes from `SITUATION_CATEGORIES` (shared).
// Injected by `buildDehydrateSystemPrompt` only for the tactics the user enabled
// (which, per the recommended default, is none).
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
 * SINGLE source of truth for how aggressively filler 套路 are tightened. 0 =
 * off → no situational 脱水 at all (the whole block is omitted from the prompt,
 * regardless of which tactics are checked); 1/2/3 = light/medium/heavy.
 *
 * CRITICAL — these levels describe PROSE-TIGHTENING, NEVER summarization or
 * outline-style condensation. The rewriter produces full readable novel prose,
 * not a synopsis. Every level MUST (a) keep the reader inside the scene (no
 * "本章讲述了……" meta-narration, no jumping over events), and (b) preserve all
 * effective information (new events, relationship shifts, character reveals,
 * irreversible choices, key payoffs). The ONLY thing that changes across
 * levels is how much repetitive/padded micro-texture survives inside a kept
 * beat — from "trim the worst" (轻) to "strip almost all of it" (重). No level
 * is allowed to collapse a kept scene down to a one-line summary: even at 重,
 * a scene that carries effective information stays a scene, told in prose.
 *
 * Why this matters at large chunk sizes: when the input is long, an
 * outline-style instruction reads as "compress everything" and the model
 * returns a few sentences per chapter. These levels are deliberately scoped to
 * *intra-beat texture*, so output length tracks input length regardless of how
 * big the chunk is.
 */
const SITUATION_STRENGTH_LEVELS: Record<1 | 2 | 3, string> = {
  1: "轻度收紧：只修剪最明显的重复套话与注水段落（同义句堆叠、反复确认、模板化拆帧、刷屏式群众反应等），保留其中的场景、动作与情绪细节。读者几乎感觉不到删减，只是节奏更顺。绝不把任何场景概括成一两句话。",
  2: "中度收紧：对注水段落做实质性精简——删掉重复的反应、多余的铺垫、流水账式的流程描写，但保留场景本身的过程、关键细节与情绪起伏。场景仍是完整的场景，只是去掉了水分；不要用一句话代替一段戏。",
  3: "重度收紧：对注水段落做大幅度删减，只保留推进剧情或承载信息的核心要素，可以跳过大量重复与堆砌。但即便如此，凡是有信息量或情绪推进的场景，都必须以完整的叙事 prose 呈现，严禁改写成概括、提纲或'本章主要讲了……'式的陈述句。",
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

// ---------------------------------------------------------------------------
// Cross-chapter filler-stripping rules (章节并写 · 跨章情境脱水).
//
// Mirror of `SITUATION_TACTICS`, but for the 34 tactics whose 套路 can only be
// judged across multiple chapters (e.g. whether a setup was already explained
// earlier, whether a scenario is repeating). `Record<keyof CrossChapterTactics,
// …>` so a new cross tactic in the schema surfaces here as a missing-key error.
// Category labels reuse `SITUATION_CATEGORY_LABELS` (cross tactics fall under
// the same 16 `TacticCategory`s). Same `rule` discipline: identify the 套路 and
// the purge direction only — never HOW or to what EXTENT (the strength dial's
// job). Injected by `buildDehydrateSystemPrompt` ONLY in the `multi` variant
// (single chapter has no cross-chapter context), merged into the same tactic
// array as the situation tactics under one shared strength dial.
// ---------------------------------------------------------------------------

const CROSS_CHAPTER_TACTICS: Record<
  keyof CrossChapterTactics,
  { label: string; rule: string }
> = {
  tournamentLoop: {
    label: "擂台赛/排名赛循环",
    rule:
      "一场场无关配角上场的擂台、排名、大比武、联赛、才艺比试。其中无关配角的上场、与主线资源无关的场次" +
      "，是水；与主角或核心对手有关、会改变资源分配或引出更强对手的场次，才是有效信息。",
  },
  escalatingElders: {
    label: "“护短长辈”逐级登场",
    rule:
      "“打了小的来老的”：弟子→长老→宗主→太上长老→背后圣地逐级登场。其中相似层级的重复上位者、不改变冲突规模的人" +
      "，是水；逼出新选择、改变冲突规模或揭示新势力关系的上位者，才是有效信息。",
  },
  misunderstandings: {
    label: "误会拉扯",
    rule:
      "看见半句话就误会、彼此都不解释、朋友反复劝、冷战多章。其中纯靠“不解释”硬拖的拉扯、没有信息增量的循环" +
      "，是水；首次暴露真实需求、推动关系升级或导向行动的误会，才是有效信息。",
  },
  jealousyCycles: {
    label: "吃醋桥段循环",
    rule:
      "白月光/青梅/前任一出现就误会、冷脸、追问、暧昧升级。其中每次换人却重复同一套流程的循环" +
      "，是水；推动关系升级或暴露人物真实需求的部分，才是有效信息。",
  },
  familyGossip: {
    label: "家长里短/亲戚群像",
    rule:
      "婆媳、妯娌、分家、彩礼、邻里闲话、亲戚借钱等家长里短。其中不影响主角处境、资源、名声或情感的闲话" +
      "，是水；会改变主角处境、资源或关系的冲突，才是有效信息。",
  },
  braindeadVillains: {
    label: "降智反派反复送人头",
    rule:
      "“上次是意外！”“这次他必死！”反派每次都不吸取教训、用同一套自信宣言再送一次。其中无新策略的重复失败、反复的自信宣言" +
      "，是水；带来新威胁、新代价或逼出主角新手段的部分，才是有效信息。",
  },
  questDungeon: {
    label: "做任务/刷副本",
    rule:
      "接任务、看说明、备道具、清小怪、支线、NPC对话、解谜、BOSS、结算的完整副本流程。其中重复的清怪、无关支线、模板化的结算" +
      "，是水；主线目标、关键选择、BOSS对决和最终奖励，才是有效信息。",
  },
  climaxPovSwitch: {
    label: "卡高潮前切视角",
    rule:
      "主角刚要出手就切反派、切路人、切女主，下一章才回来。其中无关键反转或危险升级的视角切换" +
      "，是水；新视角提供新信息、新后果或危险升级的部分，才是有效信息。",
  },
  multiPovReplay: {
    label: "多视角重复同一事件",
    rule:
      "同一件事从主角、反派、路人、女主、新闻视角各讲一遍。其中未提供新信息或新后果的重复视角" +
      "，是水；每个视角带来新信息、新后果或新判断的部分，才是有效信息。",
  },
  dreamIllusionTrial: {
    label: "梦境/幻境/试炼",
    rule:
      "心魔幻境、前世梦、轮回试炼、秘境幻象、精神世界。其中无剧情推进的纯场景漫游、重复的恐惧渲染" +
      "，是水；揭示人物恐惧欲望、给出关键线索或推动现实选择的内容，才是有效信息。",
  },
  secretRealm: {
    label: "秘境/遗迹探索",
    rule:
      "入口争夺、规则说明、遇机关妖兽草药传承旧敌、最后抢宝的完整秘境流程。其中重复的环节、模板化的机关与战斗" +
      "，是水；核心宝物、主角的关键选择与由此引发的冲突，才是有效信息。",
  },
  auction: {
    label: "拍卖会",
    rule:
      "进场被看不起、包厢等级、拍卖师出场、逐件拍品、竞价、捡漏、截杀。其中与主角目标无关的逐件拍品、重复的竞价流程" +
      "，是水；与主角目标或主线有关的拍品、引发冲突或改变资源的竞价，才是有效信息。",
  },
  entranceExam: {
    label: "宗门/学院/公司考核",
    rule:
      "入门测试、天赋灵根精神力体能测试、笔试实战面试、排名公布的完整考核。其中不区分能力、不决定资源分配的环节" +
      "，是水；区分能力、决定资源分配或引出对手的环节，才是有效信息。",
  },
  identityReveals: {
    label: "反复“身份揭露”",
    rule:
      "神医、黑客、豪门继承人、战神、影帝……每揭一个马甲就水一轮震惊。其中无剧情后果的纯震惊、重复的揭露流程" +
      "，是水；每次揭露带来的新剧情后果、新敌人或新关系，才是有效信息。",
  },
  nobodyKnowsMc: {
    label: "别人不知道主角是谁",
    rule:
      "柜员、同学、亲戚、反派、上司、未婚妻家人都不认识主角，每换场景就重新打脸。其中不造成实际阻碍、纯为打脸而打脸的重复" +
      "，是水；造成实际阻碍、改变关系或引发冲突的部分，才是有效信息。",
  },
  heiressDrama: {
    label: "真假千金家庭拉扯",
    rule:
      "真千金回家、假千金委屈、父母偏心、哥哥误会、宴会出丑、才艺打脸、家人后悔的完整拉扯。其中重复的委屈、误会与打脸流程" +
      "，是水；推动身份真相、改变家庭关系或主角处境的冲突，才是有效信息。",
  },
  evilSidekick: {
    label: "恶毒女配作妖",
    rule:
      "故意摔倒、诬陷偷东西、抢功劳、装可怜、买水军、设计误会。其中重复的作妖手段、无新意的陷害" +
      "，是水；新手段、主角的反制以及由此改变的关系或处境，才是有效信息。",
  },
  varietyLivestream: {
    label: "综艺/直播任务",
    rule:
      "嘉宾入场、分组、做饭游戏采访、弹幕黑粉热搜CP粉、导演组反应的完整综艺流程。其中无关的游戏环节、刷屏的弹幕" +
      "，是水；任务规则、人物冲突和舆论后果，才是有效信息。",
  },
  engagementHumiliation: {
    label: "退婚/羞辱/三年之约",
    rule:
      "被羞辱、立誓、修炼、比试、打脸、对方后悔、更强势力登场的完整退婚流。其中过长的嘲讽铺垫、重复的羞辱" +
      "，是水；核心矛盾、誓言以及由此推动的修炼与冲突，才是有效信息。",
  },
  recruitingMinions: {
    label: "收小弟",
    rule:
      "小弟不服、见识实力、震惊、纳头便拜、介绍背景、家族麻烦、主角顺手解决的完整收服流程。其中“不服—拜服”的重复流程、模板化的背景介绍" +
      "，是水；改变势力格局、带来新麻烦或新资源的部分，才是有效信息。",
  },
  haremRotation: {
    label: "后宫/暧昧角色轮番出场",
    rule:
      "每个新地图一个新女性角色、身份各异、都对主角特殊、原有角色吃醋。其中无新信息、纯凑数的出场、重复的吃醋" +
      "，是水；对主线或关系格局有影响的互动，才是有效信息。",
  },
  baseBuilding: {
    label: "基地建设",
    rule:
      "修围墙、分配房间、制定规则、招募人员、物资统计、防御体系、种植养殖、内部矛盾的完整基地流。其中模板化的建设细节、无关的内部琐事" +
      "，是水；关键的建设决策、资源矛盾以及由此引发的冲突，才是有效信息。",
  },
  puzzleTrialError: {
    label: "解谜反复试错",
    rule:
      "发现线索、推翻猜想、重新讨论、又发现线索、玩家争论、主角沉思、最后揭示。其中无效猜想、重复的讨论与推翻" +
      "，是水；关键线索、决定性的推断与最终结论，才是有效信息。",
  },
  corporateMeetings: {
    label: "商战会议",
    rule:
      "市场分析、股东争论、投资人施压、对手公司动作、财报数据、公关方案、法务风险的完整会议。其中不导向决策的争论、无关的数据罗列" +
      "，是水；决策冲突、主角的关键判断以及由此改变的商业格局，才是有效信息。",
  },
  projectCompetition: {
    label: "公司对赌/项目竞争",
    rule:
      "两组竞争、方案比拼、上司偏心、同事使绊、客户刁难、主角逆袭的完整项目流。其中重复的使绊、无关的比拼环节" +
      "，是水；竞争目标、阻碍、破局与最终结果，才是有效信息。",
  },
  fandomWars: {
    label: "粉圈撕番/控评",
    rule:
      "粉丝争番位、营销号带节奏、对家下黑稿、工作室声明、CP粉狂欢、黑粉破防的完整粉圈流。其中刷屏的控评、无关的撕扯" +
      "，是水；舆论转向以及对主角事业有实质影响的部分，才是有效信息。",
  },
  mapProgressionTemplate: {
    label: "“小地图升大地图”重复模板",
    rule:
      "每到新地图都“被看不起—惹小反派—打小反派—惹大反派—升级—换地图”。其中重复的前半段套路" +
      "，是水；新地图提供的新规则、新冲突或新选择，才是有效信息。",
  },
  escalatingCrisis: {
    label: "“危机—解决—更大危机”机械循环",
    rule:
      "刚打完妖兽秘境崩塌、刚逃出仇家堵门、刚进宗门发现内鬼，危机机械堆叠。其中无代价、无人物变化的机械危机" +
      "，是水；每个危机带来的代价、人物变化或新选择，才是有效信息。",
  },
  infinitePrep: {
    label: "“准备阶段”无限拉长",
    rule:
      "大战/婚礼/比赛/考试前的装备、药品、计划、阵法、谈心、反派准备的完整准备阶段。其中不影响最终结果的准备细节、重复的备战" +
      "，是水；影响最终结果的准备、核心事件的尽快开场，才是有效信息。",
  },
  palaceEtiquette: {
    label: "宫斗：请安/赏赐/规矩",
    rule:
      "每日请安、位份、赏赐单子、宫规解释、传话、座次、行礼的完整宫斗日常。其中不体现权力变化的流水账式礼仪" +
      "，是水；体现权力变化、设置陷阱或引发冲突的礼仪细节，才是有效信息。",
  },
  householdAccounts: {
    label: "宅斗：账本/嫁妆/管家权",
    rule:
      "查账、管铺子、月例、整顿下人、克扣银钱、嫁妆单子、庶嫡规矩的完整宅斗日常。其中无关的账目流水、重复的规矩说明" +
      "，是水；关键账目问题、利益冲突以及由此改变的家庭格局，才是有效信息。",
  },
  farmingRoutine: {
    label: "种田：农活流程",
    rule:
      "翻地、播种、浇水、施肥、收割、做饭、赶集、卖货、盖房的完整农活流程。其中重复的农活细节、无关的流程" +
      "，是水；体现生产变化、生活改善或引发冲突的步骤，才是有效信息。",
  },
  eraFictionCoupons: {
    label: "年代文：票证/物资/邻里",
    rule:
      "粮票布票工分、大院邻居、厂里评优、相亲、婆婆妈妈议论的年代文日常。其中不体现时代约束、不引发资源冲突的流水账" +
      "，是水；体现时代约束、资源冲突以及由此推动的剧情，才是有效信息。",
  },
  cthulhuDelaying: {
    label: "克苏鲁/悬疑：不可名状拖延",
    rule:
      "无法描述的恐惧、难以理解的低语、诡异符号、似乎被注视、说不上哪里不对。其中纯粹堆叠氛围、不形成线索的故弄玄虚" +
      "，是水；能形成线索、推动恐惧升级或导向发现的描写，才是有效信息。",
  },
};

const DEPTH_ORDER: (keyof DehydrateDepth)[] = ["prosePolish", "proseExpand"];

interface DepthAspectText {
  label: string;
  desc: string;
  levels: Record<1 | 2 | 3, string>;
}

const DEPTH_ASPECTS: Record<keyof DehydrateDepth, DepthAspectText> = {
  prosePolish: {
    label: "文笔打磨",
    desc: "润色文笔本身——用词、句式、节奏、流畅度。只改'怎么写'，不显著改变篇幅，不增加原文没有的内容。",
    levels: {
      1: "只理顺明显生硬、拗口的句子，修正节奏与用词上的明显瑕疵。",
      2: "把四平八稳的句子打磨得更有韵律和味道，优化全章的用词、句式与节奏，让文笔整体上一个台阶。",
      3: "通篇精修——逐句打磨用词、句式、节奏与文气，追求较高的文学质感，但始终不改变情节、不增删内容、不改变篇幅。",
    },
  },
  proseExpand: {
    label: "文笔扩写",
    desc: "在恰当的地方，运用修辞手法和修饰手法适当扩写，丰富表达、增强现场感与感染力。可以加入原文没有的内容，但一切扩写都必须服务于增强原书的看点——爽点更燃、情绪更扎心、氛围更沉浸、人物更立体——绝不为了凑字数而注水。",
    levels: {
      1: "只在少数关键场景（名场面、高潮、情绪爆发）点几笔修辞与感官细节，起到画龙点睛的效果。",
      2: "在多处恰当的段落运用修辞手法扩写——丰富关键场景的感官层次、情绪深度与画面感，让干瘪的叙述变得有感染力，同时保持节奏不拖沓。",
      3: "通篇寻找扩写空间，运用多种修辞与文学手法大幅丰富表达——让每一个值得展开的场景都饱满、立体、有画面感。但即便如此，扩写仍须服务于看点，不得注水。",
    },
  },
};
// ---------------------------------------------------------------------------

type DehydrateVariant = "single" | "multi";

// Core invariants — the "do not break" bottom line. Both variants share the
// first and last invariants (no new plot/facts, only "how it's written";
// preserve dialogue information & subtext). They differ on the chapter
// boundary: single stays strictly within the one given chapter, while multi is
// free to heavily rewrite the seams between chapters to weld them into one
// organic chapter (it merges/re-chapters by design), only forbidding invented
// plot/facts and unrequested continuation/ending.
const CORE_INVARIANTS: Record<DehydrateVariant, string> = {
  // single — single-chapter rewrite: respect this one chapter's boundary.
  single:
    "无论后续如何改写，以下底线始终不可破坏：\n" +
    "- 不增加情节、不改写事实，你改的是“怎么写”，不是“写了什么”。\n" +
    "- 守住本章的边界与视角：不要补写前后章节的内容，不要擅自续写或收尾。\n" +
    "- 保留对话的信息量与潜台词：只在表达层面优化，不要让人物说出原本没说过的话。",
  // multi — multi-chapter merge/re-chapter: chapters are free to merge,
  // but the source material is the limit.
  multi:
    "无论后续如何合并改写，以下底线始终不可破坏：\n" +
    "- 不增加情节、不改写事实，你改的是“怎么写”，不是“写了什么”。\n" +
    "- 可以大幅改写章节衔接处的文字，把原本割裂的章节熔成一章；" +
    "但不要补写原文没有的情节或事实，不要擅自续写或收尾。\n" +
    "- 保留对话的信息量与潜台词：只在表达层面优化，不要让人物说出原本没说过的话。",
};

const ROLE_LINE: Record<DehydrateVariant, string> = {
  // single — single-chapter rewrite (one already-chaptered chapter).
  single:
    "你是一名资深的中文小说重写编辑。你的任务是把给定的一章原文，重写成阅读体验显著更好的版本。",
  // multi — cross-chapter 章节并写: strip each chapter's filler, then let the
  // surviving high-density material merge ACROSS the original chapter seams so
  // a few thin chapters weld into fewer full ones. This is NOT re-boundary-ing
  // intact chapters; the original seams are ignored on purpose. The soft
  // min-char target below drives the merge (脱水后太薄 → 合并相邻章); the
  // coherence hard-constraint brakes it (never weld unrelated scenes).
  multi:
    "你是一名资深的小说脱水编辑。你的唯一目的是重写文本以显著提高用户的阅读体验。" +
    "给定一段小说原文，请跨章重写：忽略原文的章节边界，先把每章里的注水套路按下方脱水强度收紧，" +
    "再把脱水后剩下的有效内容跨原章边界重新组织——" +
    "原本被注水撑成好几章、其实只有一章干货的，合并成一章；原本割裂的连续场景，接回成一章。" +
    "这样做的目的是让节奏更紧凑、阅读体验更好，因此最终产出的章数通常会比原文少——这是脱水合并的自然结果，不是你要追求的指标。" +
    "每章的目标篇幅约 2000–3000 字（柔性参考，不是硬性下限）：" +
    "如果脱水后某章内容明显偏薄（比如只剩几百字的干货），优先考虑把它与剧情连贯的相邻章合并成一章；" +
    "但绝不为了凑字数而把剧情/场景不连贯的章节强行拼在一起——合并的前提永远是内容连贯，字数只是帮助你判断'该不该合并'的参考。" +
    "对每一章，同时给出该章的简明标题与脱水合并重写后的完整正文。",
};

const OUTPUT_CONTRACT: Record<DehydrateVariant, string> = {
  // single — single `content` via outputProcessedContent.
  single:
    "The only thing you are allowed to do is to call the outputProcessedContent tool:\n" +
    "- Place the full rewritten content in the tool's `content` parameter;\n" +
    "- You are not allowed to output rewritten content anywhere else " +
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
    "will result in fatal failure.",
  // multi — array of `{ title, content }` via outputChapters. Pure mechanics;
  // editorial guidance (re-chapter intent, anti-summary) lives in the Chinese
  // ROLE_LINE + philosophy block — not duplicated here in the wrong language.
  multi:
    "The only thing you are allowed to do is to call the outputChapters tool:\n" +
    "- Pass an array of chapters; each entry has `title` (a short, reader-facing " +
    "chapter name for the chapter you just produced), `content` (the full " +
    "dehydrated chapter prose).\n" +
    "- `title` = the SOURCE chapter range, copied in the SAME numbering format " +
    "and language the source itself uses for its chapter headings, followed by " +
    "the evocative chapter name. Read the original chapter headings in the input " +
    "to see (a) which source chapters you merged into this output chapter and " +
    "(b) the numbering convention to copy — then mirror it exactly. Examples of " +
    "the SAME title in different sources' conventions: '第三十一至三十五章 风起天南', " +
    "'Chapter 31–35 The Storm', '第31〜35章 嵐の夜'. Single source chapter → no " +
    "range, just that one heading's number. Do NOT invent a new sequential " +
    "output number — the app renders its own chapter number separately, so that " +
    "would be duplicated.\n" +
    "- `content` must contain only the prose itself: no explanations, no Markdown, " +
    "no chapter titles; preserve sensible paragraph breaks.\n" +
    "- Keep the output language the same as the source unless translation/" +
    "localization is requested above.\n" +
    "- You are NOT allowed to output prose as plain text; it must go through " +
    "outputChapters tool call. Emitting plain text without the tool is fatal.",
};

// ---------------------------------------------------------------------------
// Public builder
// ---------------------------------------------------------------------------

/**
 * Build the Chinese system prompt for a dehydrate rewrite agent from the wizard
 * options. Sections are injected in a fixed editorial order and joined into one
 * organic brief: role → core invariants → 基础清洗 → 脱水块（情境，multi 下含
 * 跨章）→ 打磨文笔 → 语言与翻译 → 自定义指令 → output contract. Optional
 * sections appear only when they have something to say.
 *
 * `variant` selects three variant-specific pieces (role line, core invariants,
 * output contract):
 *   - `"single"` — one already-chaptered chapter → outputProcessedContent.
 *   - `"multi"`  — raw chunk → merge/re-chapter → outputChapters.
 * The shared body between them is otherwise identical.
 *
 * Core invariants differ on the chapter-boundary rule: single stays strictly
 * within this one chapter; multi may weld chapters together but not invent
 * beyond the source.
 *
 * 脱水块: `situation.strength` is the single on/off + intensity dial for the
 * whole block in both variants. Tactic sources are variant-specific — single
 * uses only `situation.tactics`; multi merges `situation.tactics` +
 * `crossChapter.tactics` into one array (cross-chapter 套路 need multi-chapter
 * context, which only the multi variant provides). `crossChapter.strength` is
 * not used by the prompt.
 *
 * Per-tactic checkboxes are OPTIONAL ENFORCEMENT (recommended OFF). When none
 * are checked, the block still appears if `strength > 0` (driven purely by the
 * strength dial + the脱水 philosophy), but lists no individual tactics — a
 * clean, noise-free prompt. Checked tactics only add identification hints.
 *
 * Strength = how much intra-beat filler-texture survives, NEVER a summarization
 * depth. The philosophy block carries an explicit protective invariant against
 * collapsing prose into outlines/synopsis; this matters most at large chunk
 * sizes, where an outline-style instruction reads as "compress everything".
 */
export function buildDehydrateSystemPrompt(
  options: DehydrateConfig["options"],
  variant: DehydrateVariant,
): string {
  const { basic, situation, crossChapter, depth, language, customInstruction } =
    options;
  const sections: string[] = [];

  // Role + goal (always on) — gives the brief its voice and purpose.
  sections.push(ROLE_LINE[variant]);

  // Core invariants (always on) — the "do not break" bottom line, variant-
  // specific on the chapter-boundary rule (single stays within this chapter;
  // multi may weld chapters together but not invent beyond the source).
  sections.push(CORE_INVARIANTS[variant]);

  // 基础清洗 — one bullet per enabled toggle; all-off → section omitted.
  const basicRules = BASIC_ORDER.filter((k) => basic[k]).map(
    (k) => `- ${BASIC_RULES[k]}`,
  );
  if (basicRules.length) {
    sections.push(["基础清洗：", ...basicRules].join("\n"));
  }

  // 脱水块 — situational filler-stripping. `situation.strength` is the
  // on/off + intensity control. 0 (off) → the WHOLE feature is skipped: no
  // block (not even the framing) appears, regardless of which tactics are
  // checked. 1/2/3 → handled at that intensity. This strength is the SINGLE
  // dial for the whole block in both variants.
  //
  // Tactic sources are variant-specific:
  //   - single: only `situation.tactics` (single-chapter context).
  //   - multi:  `situation.tactics` + `crossChapter.tactics` merged into ONE
  //     array — cross-chapter tactics can only be judged when multiple chapters
  //     are visible, which only the multi variant (raw-chunk merge) provides.
  // Both sources share the category labels (`SITUATION_CATEGORY_LABELS`) and
  // the strength dial above.
  //
  // Prompt design — four cleanly separated concerns, so they never conflict:
  //   1. General direction: the脱水 philosophy (what counts as effective info
  //      to keep vs. what counts as filler), plus the explicit hand-off that
  //      the tightening STRENGTH is governed solely by the dial below.
  //   2. Protective invariant (hard, unconditional): the output is always full
  //      novel prose, never an outline/synopsis; output length tracks the
  //      effective-information volume, not "shorter is better". This is what
  //      stops the model from collapsing large chunks into a few sentences.
  //   3. Strength dial (SITUATION_STRENGTH_LEVELS): the SINGLE source of truth
  //      for how much intra-beat filler texture survives. All three levels are
  //      listed so the model has a calibrated sense of the dial, then the
  //      chosen level is named and its description reprinted so the active
  //      strength is unambiguous.
  //   4. Tactics (SITUATION_TACTICS / CROSS_CHAPTER_TACTICS): OPTIONAL
  //      identification hints, only emitted when the user checks some. Each
  //      identifies a 套路 + what's filler vs. valuable core; tightening depth
  //      is always the dial's job, never the tactic's.
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
  // Cross-chapter tactics only contribute in the multi variant.
  if (variant === "multi") {
    for (const cat of CROSS_CHAPTER_CATEGORIES) {
      const on = cat.tactics.filter((k) => crossChapter.tactics[k]);
      if (!on.length) continue;
      const items = on.map(
        (k) =>
          `  · ${CROSS_CHAPTER_TACTICS[k].label}：${CROSS_CHAPTER_TACTICS[k].rule}`,
      );
      situationBlocks.push(
        `- ${SITUATION_CATEGORY_LABELS[cat.key]}：\n${items.join("\n")}`,
      );
    }
  }
  if (situation.strength > 0) {
    const lvl = situation.strength as 1 | 2 | 3;
    const strengthLines = [
      "情境脱水——针对网文常见的「水字数」套路做收紧。" +
        "底层只有一条原则：凡推动主线的新事件、改变人物关系的新互动、展现人物性格的新行为、" +
        "引出冲突的新信息、不可逆的选择，以及必要的爽点、情绪爆发、反转与伏笔，都属有效信息，一律保留。" +
        "判断每一段去留的唯一标准是——它是否为读者提供了新的信息或新的情绪推进。",
      "⚠ 把握好「度」——脱水不足与脱水过度都是失败。" +
        "脱水不足：原文的注水套路原样保留，读者体验没有改善。" +
        "脱水过度：把正文压成大纲、梗概或'本章主要讲了……'式的陈述，丢掉了现场感与看点。" +
        "正确的度是：只删注水套路的重复与堆砌，保留所有有效信息与情绪推进，" +
        "产出完整的、可读的小说正文，让原书的爽点、反转、名场面更突出，而不是被稀释或概括掉。" +
        "无论原文多长、也无论你选了哪个强度，都不得把场景或章节压缩成几句梗概、不得跳过事件本身。" +
        "输出篇幅应与原文中有效信息的体量成正比——信息量大，重写后依然应是完整的篇幅，而不是越短越好。",
      "收紧到什么程度，完全由下面的「脱水提速强度」决定：不要自行加码力度，也不要自行发明压缩方法。",
      "脱水提速强度（本次收紧程度的唯一标尺，严格按所选力度执行，既不要加码也不要打折）：\n" +
        `· 轻：${SITUATION_STRENGTH_LEVELS[1]}\n` +
        `· 中：${SITUATION_STRENGTH_LEVELS[2]}\n` +
        `· 重：${SITUATION_STRENGTH_LEVELS[3]}\n` +
        `➤ 本次选用「${LEVEL_LABEL[lvl]}」度脱水。\n` +
        `➤ 本次所选力度的执行口径（请严格照此执行）：${SITUATION_STRENGTH_LEVELS[lvl]}`,
    ];
    // Only inject the per-tactic hints when the user actually checked some —
    if (situationBlocks.length) {
      strengthLines.push(
        (variant === "multi" ?
          "下面是你勾选、需要识别并处理的具体情境套路（含需跨章判断的套路）。"
        : "下面是你勾选、需要识别并处理的具体情境套路。") +
          "每条只说明「这是什么套路、其中哪些是水、哪些才是有效信息」，作为你识别与判断的依据；" +
          "遇到后按上方所选强度收紧其中的注水部分，但其中的有效信息必须以完整 prose 保留，不得改成概括。",
        ...situationBlocks,
        "以上情境，只在原文确实出现、且属于上述套路的段落上按本次所选强度收紧；不涉及的段落不要强行改写。",
      );
    }
    sections.push(strengthLines.join("\n\n"));
  }

  // 打磨文笔 — literary polish (prosePolish) and/or expansion (proseExpand).
  // Each enabled category lists 轻/中/重 and names the chosen level. Note this
  // module is about improving/extending prose quality — the OPPOSITE direction
  // from 脱水. Both can coexist with 脱水: dehydration strips filler, then
  // polish/expand refines and enriches what survives.
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
        "打磨文笔：以下每项都已指明本次采用的强度，请严格按指明的力度执行。" +
          "注意——这一步的方向和「脱水」相反：脱水负责删掉注水套路，打磨文笔负责让删完之后的有效内容更好读、" +
          "甚至更丰满。两者不冲突，先脱水、再打磨。既不要自行加码力度，也不要打折。",
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

  // Output contract (always on) — variant-specific. Closes the brief.
  sections.push(OUTPUT_CONTRACT[variant]);

  return sections.join("\n\n");
}
