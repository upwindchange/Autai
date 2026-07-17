import { z } from "zod";

/**
 * Entertainment-mode configuration contract.
 *
 * The wizard (renderer) builds an `EntertainmentConfig` and sends it to the
 * entertainment REST endpoints (`/upload` for a file, `/setup` for an internet
 * novel) as the `config` field. The backend validates it with
 * `EntertainmentConfigSchema` and persists it; `novel.type` (`file` |
 * `internet`) drives the scheduler's file-vs-internet behaviour.
 *
 * Key shapes:
 *   - `mode` discriminates the top-level union (`dehydrate` | `interactive`).
 *     Only `dehydrate` is served today; `interactive` is a UI-only "coming soon"
 *     placeholder with no backend yet.
 *   - `novel` is mode-dependent: `dehydrate` accepts file OR internet;
 *     `interactive` accepts a text file ONLY.
 *   - Both modes share Module 1 (basic toggles) + Module 1b (情境脱水 — a
 *     `strength` dial that gates the whole feature, plus 65 per-tactic toggles
 *     selecting which single-chapter padding patterns to strip) + Module 1c
 *     (章节并写 — same shape, over the 20 padding patterns whose rule needs
 *     cross-chapter context; accepted by the backend but not yet acted on) +
 *     each `{ enabled, level }`, defaulting off) + Module 3 (language
 *     adaptation) + a `nonNovelSource` flag (single-source storyline vs.
 *     chaptered novel) + a free-form `customInstruction` (user guidance applied
 *     on top of all three). `interactive` additionally carries
 *     `interactionFrequency`.
 */

// --- Novel inputs ----------------------------------------------------------

export const FileNovelSchema = z.object({
  type: z.literal("file"),
  filename: z.string().min(1),
  // native-picker only: lets a future "show in folder" affordance work.
  fsPath: z.string().optional(),
});

export const InternetNovelSchema = z.object({
  type: z.literal("internet"),
  // Title is optional end-to-end: the backend accepts an empty title. The "book
  // title required" rule is enforced only in the wizard UI (and only when the
  // source IS a chaptered novel — see `isStepValid`).
  title: z.string().trim(),
  author: z.string().trim().optional(),
  // A URL, a search instruction, or other guidance on where to read the novel.
  source: z.string().trim().min(1),
});

// dehydrate accepts either; interactive uses FileNovelSchema directly.
export const NovelInputSchema = z.discriminatedUnion("type", [
  FileNovelSchema,
  InternetNovelSchema,
]);

// --- Shared option blocks (composed into both modes) -----------------------

/** Module 1 — 基础清洗 (toggle features). */
const DehydrateBasicSchema = z.object({
  grammarFix: z.boolean().default(true),
  webSlangFilter: z.boolean().default(true),
});

/**
 * The 85 网文 "水字数" tactics from `situation.md`, partitioned by where they
 * typically appear. The partition (see `TACTIC_SCOPE`) drives which blocks a
 * tactic shows up in:
 *
 *   - `single` (36 tactics) — local fillers expanded by description /
 *     explanation / reaction / dialogue / formatted text WITHIN one chapter.
 *     Live in `SituationTactics` only.
 *   - `cross` (34 tactics) — need a process or a loop to "water up"; they only
 *     truly drag across multiple chapters (tournaments, secret realms, harem
 *     rotation, crisis chains, palace/household long arcs). Live in
 *     `CrossChapterTactics` only.
 *   - `both` (15 tactics) — scene-modules that work either as a one-chapter
 *     scene OR a multi-chapter arc (banquet, trial, travel, training, hidden
 *     power, treasure appraisal, …). Live in BOTH tactic sets, so the user can
 *     toggle them independently under 脱水提速 and 章节并写.
 *
 * Net: SituationTactics has 51 keys (36 single + 15 both); CrossChapterTactics
 * has 49 keys (34 cross + 15 both). 15 keys are shared between the two.
 */
const TACTIC_SCOPE = {
  // 一、战斗/竞技类
  tournamentLoop: "cross",
  mobGrinding: "both",
  combatFrameByFrame: "single",
  skillNameSpam: "single",
  powerLevelLecture: "single",
  fakeDisadvantage: "both",
  escalatingElders: "cross",
  // 二、群众反应类
  crowdShock: "single",
  bystanderExposition: "single",
  groupPsychology: "single",
  danmakuSpam: "single",
  mediaReports: "single",
  // 三、设定解释类
  worldbuildingEncyclopedia: "single",
  itemProfiles: "single",
  mapTours: "single",
  genealogy: "single",
  cultivationRoutine: "single",
  systemPanels: "single",
  gachaCheckin: "single",
  // 四、情感/言情类
  misunderstandings: "cross",
  innerMonologueLoop: "single",
  jealousyCycles: "cross",
  outfitDescriptions: "single",
  banquetFiller: "both",
  familyGossip: "cross",
  appearanceRedescription: "single",
  // 五、反派/打脸类
  villainMockery: "single",
  braindeadVillains: "cross",
  narratedConspiracy: "single",
  trialReveal: "both",
  // 六、日常生活类
  mealDescriptions: "single",
  travelFiller: "both",
  shoppingFiller: "both",
  questDungeon: "cross",
  trainingStudy: "both",
  // 七、对话类
  circularArguments: "single",
  leadingQuestions: "single",
  rollCallStatements: "single",
  repeatedConfirmations: "single",
  // 八、结构性拖延类
  climaxPovSwitch: "cross",
  multiPovReplay: "cross",
  flashbacks: "both",
  dreamIllusionTrial: "cross",
  secretRealm: "cross",
  auction: "cross",
  entranceExam: "cross",
  // 九、爽点循环类
  hiddenPowerLoops: "both",
  identityReveals: "cross",
  nobodyKnowsMc: "cross",
  rankingBoards: "single",
  rewardSettlement: "single",
  // 十、女频/关系流
  heiressDrama: "cross",
  evilSidekick: "cross",
  ceoControlMinutiae: "both",
  cuteBabyAssist: "both",
  varietyLivestream: "cross",
  // 十一、男频常见
  engagementHumiliation: "cross",
  recruitingMinions: "cross",
  haremRotation: "cross",
  treasureAppraisal: "both",
  medicalRescue: "both",
  // 十二、科幻/末世/无限流
  techSpecs: "single",
  apocalypseSupplies: "single",
  baseBuilding: "cross",
  instanceRules: "single",
  puzzleTrialError: "cross",
  // 十三、商业/职场/娱乐圈
  corporateMeetings: "cross",
  projectCompetition: "cross",
  actingAudition: "both",
  fandomWars: "cross",
  // 十四、形式上的
  chapterRecap: "single",
  forcedCliffhanger: "single",
  synonymStacking: "single",
  adjectivePiling: "single",
  atmosphereRedressing: "single",
  numberPiling: "single",
  // 十五、剧情循环类
  mapProgressionTemplate: "cross",
  escalatingCrisis: "cross",
  infinitePrep: "cross",
  waitingForResults: "both",
  // 十六、特殊题材专属
  palaceEtiquette: "cross",
  householdAccounts: "cross",
  farmingRoutine: "cross",
  eraFictionCoupons: "cross",
  cthulhuDelaying: "cross",
} as const satisfies Record<string, "single" | "cross" | "both">;

/** All 85 tactic keys, in `situation.md` order. */
export const ALL_TACTIC_KEYS = Object.keys(TACTIC_SCOPE) as (keyof typeof TACTIC_SCOPE)[];
/** Union of all 85 tactic keys. The concrete `SituationTactics`/`CrossChapterTactics` types each narrow this. */
export type TacticKey = keyof typeof TACTIC_SCOPE;

/**
 * The 16 content-genre categories from `situation.md`, in order. Shared by both
 * the 脱水提速 and 章节并写 blocks (the renderer + the rewriter present the same
 * grouping), so a tactic keeps its content-genre no matter which block it's in.
 * Category keys map to `options.category.<key>`; tactic labels/tooltips live at
 * `options.tactic.<tacticKey>.{label,tooltip}` (shared across both blocks).
 */
export const CATEGORY_KEYS = [
  "combatCompetition",
  "crowdReaction",
  "loreDump",
  "romanceDrag",
  "villainFaceSlap",
  "dailyLife",
  "dialogueFiller",
  "structuralDelay",
  "thrillLoop",
  "femaleAudience",
  "maleAudience",
  "sciFiApocalypse",
  "workplaceIndustry",
  "prosePadding",
  "plotLoop",
  "genreSpecific",
] as const;
export type TacticCategory = (typeof CATEGORY_KEYS)[number];

/**
 * The 16 content-genre categories with their full tactic rosters (all 85, in
 * `situation.md` order). The脱水 / 章节并写 views are derived from this by
 * filtering on `TACTIC_SCOPE`, so the canonical tactic→category mapping lives
 * in exactly one place. Tactic keys are typed as `TacticKey`, so a typo surfaces
 * as a type error; the rewriter's `Record<keyof SituationTactics, ...>` and the
 * renderer's `keyof CrossChapterTactics` backstop any key missing from a view.
 */
export const TACTIC_CATEGORIES: readonly {
  key: TacticCategory;
  tactics: readonly TacticKey[];
}[] = [
  {
    key: "combatCompetition",
    tactics: [
      "tournamentLoop",
      "mobGrinding",
      "combatFrameByFrame",
      "skillNameSpam",
      "powerLevelLecture",
      "fakeDisadvantage",
      "escalatingElders",
    ],
  },
  {
    key: "crowdReaction",
    tactics: [
      "crowdShock",
      "bystanderExposition",
      "groupPsychology",
      "danmakuSpam",
      "mediaReports",
    ],
  },
  {
    key: "loreDump",
    tactics: [
      "worldbuildingEncyclopedia",
      "itemProfiles",
      "mapTours",
      "genealogy",
      "cultivationRoutine",
      "systemPanels",
      "gachaCheckin",
    ],
  },
  {
    key: "romanceDrag",
    tactics: [
      "misunderstandings",
      "innerMonologueLoop",
      "jealousyCycles",
      "outfitDescriptions",
      "banquetFiller",
      "familyGossip",
      "appearanceRedescription",
    ],
  },
  {
    key: "villainFaceSlap",
    tactics: ["villainMockery", "braindeadVillains", "narratedConspiracy", "trialReveal"],
  },
  {
    key: "dailyLife",
    tactics: [
      "mealDescriptions",
      "travelFiller",
      "shoppingFiller",
      "questDungeon",
      "trainingStudy",
    ],
  },
  {
    key: "dialogueFiller",
    tactics: [
      "circularArguments",
      "leadingQuestions",
      "rollCallStatements",
      "repeatedConfirmations",
    ],
  },
  {
    key: "structuralDelay",
    tactics: [
      "climaxPovSwitch",
      "multiPovReplay",
      "flashbacks",
      "dreamIllusionTrial",
      "secretRealm",
      "auction",
      "entranceExam",
    ],
  },
  {
    key: "thrillLoop",
    tactics: [
      "hiddenPowerLoops",
      "identityReveals",
      "nobodyKnowsMc",
      "rankingBoards",
      "rewardSettlement",
    ],
  },
  {
    key: "femaleAudience",
    tactics: [
      "heiressDrama",
      "evilSidekick",
      "ceoControlMinutiae",
      "cuteBabyAssist",
      "varietyLivestream",
    ],
  },
  {
    key: "maleAudience",
    tactics: [
      "engagementHumiliation",
      "recruitingMinions",
      "haremRotation",
      "treasureAppraisal",
      "medicalRescue",
    ],
  },
  {
    key: "sciFiApocalypse",
    tactics: [
      "techSpecs",
      "apocalypseSupplies",
      "baseBuilding",
      "instanceRules",
      "puzzleTrialError",
    ],
  },
  {
    key: "workplaceIndustry",
    tactics: [
      "corporateMeetings",
      "projectCompetition",
      "actingAudition",
      "fandomWars",
    ],
  },
  {
    key: "prosePadding",
    tactics: [
      "chapterRecap",
      "forcedCliffhanger",
      "synonymStacking",
      "adjectivePiling",
      "atmosphereRedressing",
      "numberPiling",
    ],
  },
  {
    key: "plotLoop",
    tactics: [
      "mapProgressionTemplate",
      "escalatingCrisis",
      "infinitePrep",
      "waitingForResults",
    ],
  },
  {
    key: "genreSpecific",
    tactics: [
      "palaceEtiquette",
      "householdAccounts",
      "farmingRoutine",
      "eraFictionCoupons",
      "cthulhuDelaying",
    ],
  },
];

/**
 * All tactic keys that appear in the脱水提速 (single-chapter) view: the 36
 * `single` tactics plus the 15 `both` tactics (51 total). A tactic keyed `both`
 * appears here AND in `CROSS_CHAPTER_TACTIC_KEYS`, so the user can toggle its
 * single-chapter and cross-chapter stripping independently.
 */
export const SITUATION_TACTIC_KEYS = TACTIC_CATEGORIES.flatMap((c) =>
  c.tactics.filter((k) => TACTIC_SCOPE[k] !== "cross"),
) as TacticKey[];

/**
 * All tactic keys that appear in the 章节并写 (cross-chapter) view: the 34
 * `cross` tactics plus the 15 `both` tactics (49 total). See
 * `SITUATION_TACTIC_KEYS` for the shared-key rationale.
 */
export const CROSS_CHAPTER_TACTIC_KEYS = TACTIC_CATEGORIES.flatMap((c) =>
  c.tactics.filter((k) => TACTIC_SCOPE[k] !== "single"),
) as TacticKey[];

/** The 脱水提速 view of the 16 content-genre categories (empty categories dropped). */
export const SITUATION_CATEGORIES = TACTIC_CATEGORIES.map((c) => ({
  key: c.key,
  tactics: c.tactics.filter((k) => TACTIC_SCOPE[k] !== "cross"),
})).filter((c) => c.tactics.length > 0);

/** The 章节并写 view of the 16 content-genre categories (empty categories dropped). */
export const CROSS_CHAPTER_CATEGORIES = TACTIC_CATEGORIES.map((c) => ({
  key: c.key,
  tactics: c.tactics.filter((k) => TACTIC_SCOPE[k] !== "single"),
})).filter((c) => c.tactics.length > 0);

// Kept for back-compat with the old per-block category-key tuples — the two
// views now share the same `CATEGORY_KEYS` (a category appears in a block iff it
// has tactics there). New code should use `CATEGORY_KEYS` / `TACTIC_CATEGORIES`.
export const SITUATION_CATEGORY_KEYS = CATEGORY_KEYS;
export type SituationCategory = TacticCategory;
export const CROSS_CHAPTER_CATEGORY_KEYS = CATEGORY_KEYS;
export type CrossChapterCategory = TacticCategory;

/**
 * The tactics table for 脱水提速 (single-chapter filler stripping) — one
 * boolean per tactic that can be correctly applied WITHIN a single chapter
 * (51 keys: 36 `single` + 15 `both`). The 15 `both` tactics also appear in
 * `CrossChapterTacticsSchema`, so the user controls their single-chapter and
 * cross-chapter stripping independently. All default ON — the脱水 feature is
 * opt-OUT by tactic. The rewriter only consumes a tactic when the enclosing
 * `strength` is non-zero (see `SituationDehydrateSchema`).
 *
 * Keys are listed explicitly (not derived from `TACTIC_SCOPE`) so the inferred
 * `SituationTactics` type stays a precise 51-key object — the rewriter's
 * `Record<keyof SituationTactics, ...>` and the wizard's handlers rely on that.
 * `TACTIC_SCOPE` is the source of truth for which view each key belongs to;
 * any drift surfaces as a `pnpm tsc` error here.
 */
const SituationTacticsSchema = z.object({
  // combatCompetition
  mobGrinding: z.boolean().default(true),
  combatFrameByFrame: z.boolean().default(true),
  skillNameSpam: z.boolean().default(true),
  powerLevelLecture: z.boolean().default(true),
  fakeDisadvantage: z.boolean().default(true),
  // crowdReaction
  crowdShock: z.boolean().default(true),
  bystanderExposition: z.boolean().default(true),
  groupPsychology: z.boolean().default(true),
  danmakuSpam: z.boolean().default(true),
  mediaReports: z.boolean().default(true),
  // loreDump
  worldbuildingEncyclopedia: z.boolean().default(true),
  itemProfiles: z.boolean().default(true),
  mapTours: z.boolean().default(true),
  genealogy: z.boolean().default(true),
  cultivationRoutine: z.boolean().default(true),
  systemPanels: z.boolean().default(true),
  gachaCheckin: z.boolean().default(true),
  // romanceDrag
  innerMonologueLoop: z.boolean().default(true),
  outfitDescriptions: z.boolean().default(true),
  banquetFiller: z.boolean().default(true),
  appearanceRedescription: z.boolean().default(true),
  // villainFaceSlap
  villainMockery: z.boolean().default(true),
  narratedConspiracy: z.boolean().default(true),
  trialReveal: z.boolean().default(true),
  // dailyLife
  mealDescriptions: z.boolean().default(true),
  travelFiller: z.boolean().default(true),
  shoppingFiller: z.boolean().default(true),
  trainingStudy: z.boolean().default(true),
  // dialogueFiller
  circularArguments: z.boolean().default(true),
  leadingQuestions: z.boolean().default(true),
  rollCallStatements: z.boolean().default(true),
  repeatedConfirmations: z.boolean().default(true),
  // structuralDelay
  flashbacks: z.boolean().default(true),
  // thrillLoop
  hiddenPowerLoops: z.boolean().default(true),
  rankingBoards: z.boolean().default(true),
  rewardSettlement: z.boolean().default(true),
  // femaleAudience
  ceoControlMinutiae: z.boolean().default(true),
  cuteBabyAssist: z.boolean().default(true),
  // maleAudience
  treasureAppraisal: z.boolean().default(true),
  medicalRescue: z.boolean().default(true),
  // sciFiApocalypse
  techSpecs: z.boolean().default(true),
  apocalypseSupplies: z.boolean().default(true),
  instanceRules: z.boolean().default(true),
  // workplaceIndustry
  actingAudition: z.boolean().default(true),
  // prosePadding
  chapterRecap: z.boolean().default(true),
  forcedCliffhanger: z.boolean().default(true),
  synonymStacking: z.boolean().default(true),
  adjectivePiling: z.boolean().default(true),
  atmosphereRedressing: z.boolean().default(true),
  numberPiling: z.boolean().default(true),
  // plotLoop
  waitingForResults: z.boolean().default(true),
});

/**
 * The tactics table for 章节并写 (cross-chapter filler stripping) — one boolean
 * per tactic that needs cross-chapter context to apply (49 keys: 34 `cross` +
 * 15 `both`). The wizard surfaces these under a dedicated 章节并写 block with
 * the same strength-dial + master-switch + grouped-checkbox UX as 脱水提速. The
 * backend ACCEPTS this config (it round-trips through the `options` JSON blob)
 * but the current rewriter does NOT yet act on it — a real cross-chapter context
 * mechanism is the intended follow-up. Defaults to on so the UI presents the
 * feature as implemented; it ships as a no-op until that mechanism exists.
 */
const CrossChapterTacticsSchema = z.object({
  // combatCompetition
  tournamentLoop: z.boolean().default(true),
  mobGrinding: z.boolean().default(true),
  fakeDisadvantage: z.boolean().default(true),
  escalatingElders: z.boolean().default(true),
  // romanceDrag
  misunderstandings: z.boolean().default(true),
  jealousyCycles: z.boolean().default(true),
  banquetFiller: z.boolean().default(true),
  familyGossip: z.boolean().default(true),
  // villainFaceSlap
  braindeadVillains: z.boolean().default(true),
  trialReveal: z.boolean().default(true),
  // dailyLife
  travelFiller: z.boolean().default(true),
  shoppingFiller: z.boolean().default(true),
  questDungeon: z.boolean().default(true),
  trainingStudy: z.boolean().default(true),
  // structuralDelay
  climaxPovSwitch: z.boolean().default(true),
  multiPovReplay: z.boolean().default(true),
  flashbacks: z.boolean().default(true),
  dreamIllusionTrial: z.boolean().default(true),
  secretRealm: z.boolean().default(true),
  auction: z.boolean().default(true),
  entranceExam: z.boolean().default(true),
  // thrillLoop
  hiddenPowerLoops: z.boolean().default(true),
  identityReveals: z.boolean().default(true),
  nobodyKnowsMc: z.boolean().default(true),
  // femaleAudience
  heiressDrama: z.boolean().default(true),
  evilSidekick: z.boolean().default(true),
  ceoControlMinutiae: z.boolean().default(true),
  cuteBabyAssist: z.boolean().default(true),
  varietyLivestream: z.boolean().default(true),
  // maleAudience
  engagementHumiliation: z.boolean().default(true),
  recruitingMinions: z.boolean().default(true),
  haremRotation: z.boolean().default(true),
  treasureAppraisal: z.boolean().default(true),
  medicalRescue: z.boolean().default(true),
  // sciFiApocalypse
  baseBuilding: z.boolean().default(true),
  puzzleTrialError: z.boolean().default(true),
  // workplaceIndustry
  corporateMeetings: z.boolean().default(true),
  projectCompetition: z.boolean().default(true),
  actingAudition: z.boolean().default(true),
  fandomWars: z.boolean().default(true),
  // plotLoop
  mapProgressionTemplate: z.boolean().default(true),
  escalatingCrisis: z.boolean().default(true),
  infinitePrep: z.boolean().default(true),
  waitingForResults: z.boolean().default(true),
  // genreSpecific
  palaceEtiquette: z.boolean().default(true),
  householdAccounts: z.boolean().default(true),
  farmingRoutine: z.boolean().default(true),
  eraFictionCoupons: z.boolean().default(true),
  cthulhuDelaying: z.boolean().default(true),
});

/** Build a `SituationTactics` with every tactic set to `value` (master switch). */
export function fillSituationTactics(value: boolean): SituationTactics {
  return SITUATION_TACTIC_KEYS.reduce(
    (acc, key) => {
      acc[key] = value;
      return acc;
    },
    {} as Record<keyof SituationTactics, boolean>,
  );
}

/** Build a `CrossChapterTactics` with every tactic set to `value`. */
export function fillCrossChapterTactics(value: boolean): CrossChapterTactics {
  return CROSS_CHAPTER_TACTIC_KEYS.reduce(
    (acc, key) => {
      acc[key] = value;
      return acc;
    },
    {} as Record<keyof CrossChapterTactics, boolean>,
  );
}

/**
 * 情境脱水 (situational dehydration) — the dedicated structure modelling the
 * concept: a single `strength` dial that gates the whole feature, plus the 85
 * tactic toggles that select WHICH padding patterns to strip.
 *
 * `strength` is the on/off + intensity control in one field:
 *   - 0 = off. The whole feature is disabled — NO situational dehydration
 *     happens, and NO situational block (not even the脱水提速 framing) appears
 *     in the rewrite prompt, regardless of which tactics are checked.
 *   - 1 / 2 / 3 = light / medium / heavy. The checked tactics are stripped at
 *     that intensity.
 *
 * Defaults to strength 2 (medium) with all tactics on — the脱水 feature is the
 * app's headline capability, so it ships active and opt-OUT per tactic. The
 * depth-style `{ enabled, level }` shape is deliberately NOT reused: this is a
 * 4-state selector (off/light/medium/heavy), modelled as one scalar.
 *
 * Persisted in the `options` JSON blob, so no DB migration: `.default(...)`
 * heals older configs. Legacy shapes heal safely — a pre-restructure flat
 * tactics object or a 16-category object is missing the `strength`/`tactics`
 * keys, both of which carry defaults, so it parses to the all-on medium default
 * (unknown keys stripped); the dropped `depth.dehydrate` is simply stripped.
 * Stored configs that predate the 情境脱水/章节并写 split carry 20 tactic keys
 * here that have since moved to `CrossChapterTacticsSchema` — Zod strips them
 * (unknown keys), and the missing `crossChapter` field heals to its default.
 */
const SituationDehydrateSchema = z
  .object({
    strength: z.number().int().min(0).max(3).default(2),
    tactics: SituationTacticsSchema,
  })
  .default({ strength: 2, tactics: fillSituationTactics(true) });

/**
 * 章节并写 (cross-chapter filler stripping) — same `{ strength, tactics }`
 * shape and same defaults as `SituationDehydrateSchema`, but over the 20
 * cross-chapter tactics. The wizard renders it as a parallel block; the backend
 * accepts it but does not yet act on it (see `CrossChapterTacticsSchema`).
 */
const CrossChapterDehydrateSchema = z
  .object({
    strength: z.number().int().min(0).max(3).default(2),
    tactics: CrossChapterTacticsSchema,
  })
  .default({ strength: 2, tactics: fillCrossChapterTactics(true) });

/**
 * Module 2 — 深度重写. Each aspect is independently enabled with a 1–3
 * intensity level (1 = light · 2 = medium · 3 = heavy).
 *
 * Reshaped from a bare 1–3 number to `{ enabled, level }`. The field schema also
 * accepts a legacy bare number (pre-reshape stored configs) and heals it to
 * `{ enabled: true, level }`, so `getParsedConfig`'s `safeParse` keeps existing
 * threads valid without a migration. `.default(...)` lets a wholly-missing
 * field heal too.
 */
const DepthLevelSchema = z.number().int().min(1).max(3);

const DepthFieldSchema = z
  .union([
    z.object({
      enabled: z.boolean().default(false),
      level: DepthLevelSchema.default(2),
    }),
    DepthLevelSchema, // legacy bare number
  ])
  .transform(
    (v): { enabled: boolean; level: number } =>
      typeof v === "number" ?
        { enabled: true, level: v }
      : { enabled: v.enabled, level: v.level },
  )
  .default({ enabled: false, level: 2 });

// `dehydrate` (脱水提速) is intentionally NOT a depth aspect — it lives on the
// situational block as the strength dial for 情境脱水 (see SituationDehydrateSchema).
const DehydrateDepthSchema = z.object({
  dialoguePacing: DepthFieldSchema,
  sceneEnhance: DepthFieldSchema,
  combatEnhance: DepthFieldSchema,
  emotionEnhance: DepthFieldSchema,
  literaryEnhance: DepthFieldSchema,
});

/**
 * Module 3 — 语言适配. Dumb on/off toggles + a free-form translation field, all
 * independent (no cross-option conditional logic — nuances are the backend
 * LLM-prompt's job). `targetLanguage` holds a translation instruction or target
 * language (e.g. "文言文翻译成白话文" or "中文"; empty = none). `dialogueSubject`
 * (restore omitted dialogue speakers — a 日轻 habit) is a source-language
 * transform that doesn't need a target.
 */
const LanguageToggleSchema = z
  .object({ enabled: z.boolean().default(false) })
  .default({ enabled: false });

const LanguageAdaptationSchema = z.object({
  targetLanguage: z.string().trim().default(""),
  translate: LanguageToggleSchema,
  nameLocalization: LanguageToggleSchema,
  dialogueSubject: LanguageToggleSchema,
});

/** Interactive-only option. */
const InteractiveOptionsSchema = z.object({
  interactionFrequency: z.number().int().min(1).max(3).default(2),
});

/**
 * Free-form user guidance applied on top of Module 1/2 — whatever the toggles
 * and sliders don't cover (a tone to aim for, pet peeves to skip, etc.). Shared
 * by both modes; persisted as part of the `options` JSON blob, so it flows the
 * same path as `basic`/`depth`. `.default("")` keeps pre-existing stored
 * configs (which predate this field) valid without a migration.
 */
const CustomInstructionSchema = z.string().trim().default("");

// --- Per-mode configs ------------------------------------------------------

export const DehydrateConfigSchema = z.object({
  mode: z.literal("dehydrate"),
  novel: NovelInputSchema, // file | internet
  options: z.object({
    basic: DehydrateBasicSchema,
    situation: SituationDehydrateSchema,
    crossChapter: CrossChapterDehydrateSchema,
    depth: DehydrateDepthSchema,
    language: LanguageAdaptationSchema,
    // true = the source is one continuous text (a post, an email thread, …),
    // not a chaptered novel; segment its storyline into organic chapters
    // instead of parsing per-chapter pages/markers.
    nonNovelSource: z.boolean().default(false),
    customInstruction: CustomInstructionSchema,
  }),
});

export const InteractiveConfigSchema = z.object({
  mode: z.literal("interactive"),
  novel: FileNovelSchema, // interactive accepts a text file ONLY
  // Composes all five: interactionFrequency + Module 1/2/3 + nonNovelSource + custom.
  options: InteractiveOptionsSchema.extend({
    basic: DehydrateBasicSchema,
    situation: SituationDehydrateSchema,
    crossChapter: CrossChapterDehydrateSchema,
    depth: DehydrateDepthSchema,
    language: LanguageAdaptationSchema,
    nonNovelSource: z.boolean().default(false),
    customInstruction: CustomInstructionSchema,
  }),
});

export const EntertainmentConfigSchema = z.discriminatedUnion("mode", [
  DehydrateConfigSchema,
  InteractiveConfigSchema,
]);

export type DehydrateConfig = z.infer<typeof DehydrateConfigSchema>;
export type InteractiveConfig = z.infer<typeof InteractiveConfigSchema>;
export type EntertainmentConfig = z.infer<typeof EntertainmentConfigSchema>;
export type EntertainmentMode = EntertainmentConfig["mode"];
export type NovelInput = z.infer<typeof NovelInputSchema>;
export type FileNovel = z.infer<typeof FileNovelSchema>;
export type InternetNovel = z.infer<typeof InternetNovelSchema>;
export type DehydrateBasic = z.infer<typeof DehydrateBasicSchema>;
export type DehydrateDepth = z.infer<typeof DehydrateDepthSchema>;
export type LanguageAdaptation = z.infer<typeof LanguageAdaptationSchema>;
export type SituationTactics = z.infer<typeof SituationTacticsSchema>;
export type SituationDehydrate = z.infer<typeof SituationDehydrateSchema>;
export type CrossChapterTactics = z.infer<typeof CrossChapterTacticsSchema>;
export type CrossChapterDehydrate = z.infer<typeof CrossChapterDehydrateSchema>;

// ---------------------------------------------------------------------------
// Database-contract types (entertainment persistence layer).
//
// Shared between main (schema + services) and renderer. The dehydration
// pipeline uses TWO tables — `source_chapters` (原文) and `rewritten_chapters`
// (重写) — keyed by (threadId, chapterNumber). The reader never shows 原文; it
// renders fetching / rewriting / ready / error states derived from the two
// statuses (polled from the REST API, never from SSE).
// ---------------------------------------------------------------------------

/** Lifecycle of a `source_chapters` row (原文 acquisition). */
export type SourceChapterStatus = "fetching" | "fetched" | "error";

/** Lifecycle of a `rewritten_chapters` row (重写 transformation). */
export type RewrittenChapterStatus = "rewriting" | "rewritten" | "error";

/**
 * Lifecycle of a source chapter's outline (co-located on `source_chapters`
 * after the table merge). The outliner (file-novel pipeline) sets this during
 * the outline pass: "pending" = not yet outlined (internet/non-novel sources
 * stay here — they have no outline step); "outlined" = outline + foreshadowing
 * populated; "error" = outline failed. `isOutlineComplete` checks every source
 * row is `"outlined"` (or there are none). The reader's phase derivation treats
 * `"pending"` as "connecting" (outline in progress) for file novels.
 */
export type OutlineStatus = "pending" | "outlined" | "error";

/**
 * Per-output pipeline progress — the reader's list/TOC view. After the
 * 3-pipeline refactor the spine is the REWRITE OUTPUT (one row may cover a
 * co-writing window of multiple source chapters), so `chapterNumber` here is
 * the OUTPUT's sequential number (1,2,3,…), NOT a source-chapter number.
 * `sourceStatus`/`outlineStatus` are aggregated across the output's source
 * range (worst-case wins); `rewriteStatus` is the output row's own status. A
 * `null` status means no row for that table yet within the output's range.
 */
export interface ChapterProgress {
  /** REWRITE OUTPUT sequential number (reader spine). */
  chapterNumber: number;
  title: string | null;
  sourceStatus: SourceChapterStatus | null;
  rewriteStatus: RewrittenChapterStatus | null;
  outlineStatus: OutlineStatus | null;
}

/** Single-output detail: progress + the rewritten prose (null unless rewritten). */
export interface ChapterDetail extends ChapterProgress {
  content: string | null;
}

/**
 * Reader-facing per-chapter indicator. Values deliberately match DotMatrix
 * state names so the renderer renders `phase` with no mapping. Derived on the
 * backend (in the REST routes) from the two lifecycle statuses + the scheduler's
 * `inFlight` set, then sent to the renderer as a plain field.
 */
export type ChapterPhase =
  | "loading" // acquiring 原文 (sourceStatus "fetching")
  | "connecting" // 章节大纲生成中 (outlineStatus "outlining") — reuses DotMatrix "connecting" animation
  | "syncing" // rewriting 重写 (rewriteStatus "rewriting")
  | "error" // source or rewrite failed — terminal until Redo
  | "success" // rewritten — ready to read
  | "paused" // scheduled (auto lookahead OR manual Process/Redo), waiting to be picked up
  | "stopped"; // not scheduled (e.g. far down a long file)

/**
 * Map a chapter's DB statuses + whether it's currently scheduled (inFlight) to a
 * single DotMatrix-state phase. Pure — the single source of the status→indicator
 * mapping, run on the backend; the renderer never maps. `inFlight` covers both
 * the auto-lookahead (`ensure`) and manual "Process next N / all / Redo failed"
 * (`ensureRange` / `retryFailed`), which all go through `enqueue` →
 * `inFlight.add`; a chapter leaves the set only when its job finishes. So a
 * queued-but-not-started chapter is `paused` however it was scheduled; the
 * running chapter is already `loading`/`syncing` by status priority; a finished
 * chapter is `success`/`error`.
 */
export function deriveChapterPhase(
  ch: ChapterProgress,
  inFlight: Set<number>,
): ChapterPhase {
  if (ch.sourceStatus === "error" || ch.rewriteStatus === "error") return "error";
  // Rewriting states take priority over outlining: once a chapter's outline
  // lands, its rewrite is enqueued immediately (the outliner's progress
  // callback fires `ensure` per chapter), so a chapter already rewriting must
  // show syncing even while other chapters' outlines are still generating.
  if (ch.rewriteStatus === "rewriting") return "syncing";
  if (ch.rewriteStatus === "rewritten") return "success";
  if (ch.outlineStatus === "pending") return "connecting";
  if (ch.sourceStatus === "fetching") return "loading";
  return inFlight.has(ch.chapterNumber) ? "paused" : "stopped";
}

/**
 * A saved reading spot. `anchor` is a within-chapter coordinate: `percentile`
 * (0–100) of the rendered chapter's scroll extent (0 = top, 100 = bottom). The
 * reader both produces it (capture current scroll on bookmark) and consumes it
 * (restore scroll on jump). `chapterNumber` + `title` are joined from the
 * chapter tables so the renderer can list + jump by chapter number without ever
 * touching the DB id. `label`/`note` are nullable and currently unused
 * (auto-label is rendered client-side from chapterNumber + title so it
 * localizes); they're kept for a future editable-label/note feature with no
 * schema change.
 */
export interface BookmarkAnchor {
  percentile: number;
}

export interface Bookmark {
  id: string;
  chapterNumber: number;
  title: string | null;
  anchor: BookmarkAnchor | null;
  label: string | null;
  note: string | null;
  createdAt: string;
}

/**
 * Discriminator for the open, extensible `chapter_meta` table. Seeded with the
 * per-chapter metadata kinds from the entertainment-mode requirements:
 *   - `setting`             — per-chapter setting overrides
 *   - `user_interaction`    — a user action/choice for this chapter
 *   - `agent_comment`       — an agent-authored annotation/comment
 *   - `tool_call`           — a tool the agent invoked for this chapter
 *   - `interaction_options` — story-interaction options the agent offered
 *
 * The set is intentionally OPEN: new entertainment modes append values here and
 * define a Zod schema for the matching `payload` shape — no DB migration needed.
 */
export type ChapterMetaKind =
  | "setting"
  | "user_interaction"
  | "agent_comment"
  | "tool_call"
  | "interaction_options";
