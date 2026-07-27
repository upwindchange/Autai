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
 *   - Both modes share the option blocks: `basic` (cleanup toggles) +
 *     `situation` (情境脱水 — a `strength` dial that gates the whole feature,
 *     plus 51 per-tactic toggles, all default OFF, selecting which
 *     single-chapter padding patterns to force) + `crossChapter` (章节并写 —
 *     same shape over 34 cross-chapter-only tactics, all default OFF; accepted
 *     by the backend but not yet acted on) + `depth` (5 rewrite-intensity
 *     aspects, each `{ enabled, level }`, defaulting off) + `language`
 *     (adaptation) + a `nonNovelSource` flag (single-source storyline vs.
 *     chaptered novel) + a free-form `customInstruction` (user guidance applied
 *     on top of everything). `interactive` additionally carries
 *     `interactionFrequency`.
 *
 *     The per-tactic checkboxes under `situation`/`crossChapter` are OPTIONAL
 *     ENFORCEMENT — recommended OFF. The `strength` dial alone drives
 *     intelligent dehydration; a tactic is only ticked when the user comes back
 *     to force a specific 套路 that keeps slipping through.
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
export const ALL_TACTIC_KEYS = Object.keys(
  TACTIC_SCOPE,
) as (keyof typeof TACTIC_SCOPE)[];
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
    tactics: [
      "villainMockery",
      "braindeadVillains",
      "narratedConspiracy",
      "trialReveal",
    ],
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
 * appears here AND used to appear in the cross-chapter view, but the
 * cross-chapter view now excludes `both` (see `CROSS_CHAPTER_TACTIC_KEYS`) to
 * avoid surfacing the same tactic under two blocks — the single-chapter view
 * is where scene-module tactics are controlled.
 */
export const SITUATION_TACTIC_KEYS = TACTIC_CATEGORIES.flatMap((c) =>
  c.tactics.filter((k) => TACTIC_SCOPE[k] !== "cross"),
) as TacticKey[];

/**
 * All tactic keys that appear in the 章节并写 (cross-chapter) view: the 34
 * pure-`cross` tactics ONLY. The 15 `both` scene-module tactics are deliberately
 * excluded — they already live under 脱水提速, and showing them in both blocks
 * was redundant duplication. So a tactic appears in exactly one of the two
 * blocks (never both): `single`/`both` → 脱水提速, `cross` → 章节并写.
 */
export const CROSS_CHAPTER_TACTIC_KEYS = TACTIC_CATEGORIES.flatMap((c) =>
  c.tactics.filter((k) => TACTIC_SCOPE[k] === "cross"),
) as TacticKey[];

/** The 脱水提速 view of the 16 content-genre categories (empty categories dropped). */
export const SITUATION_CATEGORIES = TACTIC_CATEGORIES.map((c) => ({
  key: c.key,
  tactics: c.tactics.filter((k) => TACTIC_SCOPE[k] !== "cross"),
})).filter((c) => c.tactics.length > 0);

/** The 章节并写 view of the 16 content-genre categories (empty categories dropped). */
export const CROSS_CHAPTER_CATEGORIES = TACTIC_CATEGORIES.map((c) => ({
  key: c.key,
  tactics: c.tactics.filter((k) => TACTIC_SCOPE[k] === "cross"),
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
 * (51 keys: 36 `single` + 15 `both`). The 15 `both` scene-module tactics live
 * here only (they used to also appear in `CrossChapterTacticsSchema`, but that
 * duplicated them across two blocks; 章节并写 is now `cross`-only).
 *
 * All default OFF — the per-tactic checkboxes are OPTIONAL ENFORCEMENT, not the
 * primary control. The strength dial alone drives intelligent dehydration; a
 * tactic is only checked when the user comes back to force a specific 套路 that
 * keeps slipping through. The rewriter only consumes a tactic when the enclosing
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
  mobGrinding: z.boolean().default(false),
  combatFrameByFrame: z.boolean().default(false),
  skillNameSpam: z.boolean().default(false),
  powerLevelLecture: z.boolean().default(false),
  fakeDisadvantage: z.boolean().default(false),
  // crowdReaction
  crowdShock: z.boolean().default(false),
  bystanderExposition: z.boolean().default(false),
  groupPsychology: z.boolean().default(false),
  danmakuSpam: z.boolean().default(false),
  mediaReports: z.boolean().default(false),
  // loreDump
  worldbuildingEncyclopedia: z.boolean().default(false),
  itemProfiles: z.boolean().default(false),
  mapTours: z.boolean().default(false),
  genealogy: z.boolean().default(false),
  cultivationRoutine: z.boolean().default(false),
  systemPanels: z.boolean().default(false),
  gachaCheckin: z.boolean().default(false),
  // romanceDrag
  innerMonologueLoop: z.boolean().default(false),
  outfitDescriptions: z.boolean().default(false),
  banquetFiller: z.boolean().default(false),
  appearanceRedescription: z.boolean().default(false),
  // villainFaceSlap
  villainMockery: z.boolean().default(false),
  narratedConspiracy: z.boolean().default(false),
  trialReveal: z.boolean().default(false),
  // dailyLife
  mealDescriptions: z.boolean().default(false),
  travelFiller: z.boolean().default(false),
  shoppingFiller: z.boolean().default(false),
  trainingStudy: z.boolean().default(false),
  // dialogueFiller
  circularArguments: z.boolean().default(false),
  leadingQuestions: z.boolean().default(false),
  rollCallStatements: z.boolean().default(false),
  repeatedConfirmations: z.boolean().default(false),
  // structuralDelay
  flashbacks: z.boolean().default(false),
  // thrillLoop
  hiddenPowerLoops: z.boolean().default(false),
  rankingBoards: z.boolean().default(false),
  rewardSettlement: z.boolean().default(false),
  // femaleAudience
  ceoControlMinutiae: z.boolean().default(false),
  cuteBabyAssist: z.boolean().default(false),
  // maleAudience
  treasureAppraisal: z.boolean().default(false),
  medicalRescue: z.boolean().default(false),
  // sciFiApocalypse
  techSpecs: z.boolean().default(false),
  apocalypseSupplies: z.boolean().default(false),
  instanceRules: z.boolean().default(false),
  // workplaceIndustry
  actingAudition: z.boolean().default(false),
  // prosePadding
  chapterRecap: z.boolean().default(false),
  forcedCliffhanger: z.boolean().default(false),
  synonymStacking: z.boolean().default(false),
  adjectivePiling: z.boolean().default(false),
  atmosphereRedressing: z.boolean().default(false),
  numberPiling: z.boolean().default(false),
  // plotLoop
  waitingForResults: z.boolean().default(false),
});

/**
 * The tactics table for 章节并写 (cross-chapter filler stripping) — one boolean
 * per tactic that needs cross-chapter context to apply (34 `cross`-only keys).
 * The 15 `both` scene-module tactics are deliberately NOT here — they live under
 * 脱水提速 (`SituationTacticsSchema`) so each tactic appears under exactly one
 * block (no duplication). The wizard surfaces these under a dedicated 章节并写
 * block with the same strength-dial + grouped-checkbox UX as 脱水提速. The
 * backend ACCEPTS this config (it round-trips through the `options` JSON blob)
 * but the current rewriter does NOT yet act on it — a real cross-chapter context
 * mechanism is the intended follow-up; it ships as a no-op until then.
 *
 * All default OFF — same OPTIONAL-ENFORCEMENT philosophy as 脱水提速: the
 * strength dial is the primary control, the checkboxes are manual overrides for
 * stubborn 套路.
 */
const CrossChapterTacticsSchema = z.object({
  // combatCompetition
  tournamentLoop: z.boolean().default(false),
  escalatingElders: z.boolean().default(false),
  // romanceDrag
  misunderstandings: z.boolean().default(false),
  jealousyCycles: z.boolean().default(false),
  familyGossip: z.boolean().default(false),
  // villainFaceSlap
  braindeadVillains: z.boolean().default(false),
  // dailyLife
  questDungeon: z.boolean().default(false),
  // structuralDelay
  climaxPovSwitch: z.boolean().default(false),
  multiPovReplay: z.boolean().default(false),
  dreamIllusionTrial: z.boolean().default(false),
  secretRealm: z.boolean().default(false),
  auction: z.boolean().default(false),
  entranceExam: z.boolean().default(false),
  // thrillLoop
  identityReveals: z.boolean().default(false),
  nobodyKnowsMc: z.boolean().default(false),
  // femaleAudience
  heiressDrama: z.boolean().default(false),
  evilSidekick: z.boolean().default(false),
  varietyLivestream: z.boolean().default(false),
  // maleAudience
  engagementHumiliation: z.boolean().default(false),
  recruitingMinions: z.boolean().default(false),
  haremRotation: z.boolean().default(false),
  // sciFiApocalypse
  baseBuilding: z.boolean().default(false),
  puzzleTrialError: z.boolean().default(false),
  // workplaceIndustry
  corporateMeetings: z.boolean().default(false),
  projectCompetition: z.boolean().default(false),
  fandomWars: z.boolean().default(false),
  // plotLoop
  mapProgressionTemplate: z.boolean().default(false),
  escalatingCrisis: z.boolean().default(false),
  infinitePrep: z.boolean().default(false),
  // genreSpecific
  palaceEtiquette: z.boolean().default(false),
  householdAccounts: z.boolean().default(false),
  farmingRoutine: z.boolean().default(false),
  eraFictionCoupons: z.boolean().default(false),
  cthulhuDelaying: z.boolean().default(false),
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
  .transform((v): { enabled: boolean; level: number } =>
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
 * Thread-scoped runtime stop intent on `entertainment_configs.stopStatus`.
 *   - `"stopped"`: the user pressed the reader's Stop button. The thread is
 *     parked — every scheduler entry point (`ensureRange`/`runDehydrate`/
 *     `retryFailed`) no-ops, and `resumeAll` skips it on boot. Cleared ONLY by
 *     an explicit user "go" (Process next N / all, Redo failed, or a fresh
 *     wizard Start). Reopening a stopped thread does NOT clear it.
 *   - `null`: running, or never started. Crash-recovery behaviour is unchanged
 *     (mid-run rows self-heal on the next open via `needsWork`).
 */
export type StopStatus = "stopped";

/**
 * Per-output pipeline progress — the reader's list/TOC view. `chapterNumber` is
 * the REWRITE OUTPUT sequential number (the reader spine). `title` and
 * `sourceStatus` come from the source row at the same number — for pipelines
 * ②/③ that's the fetched original; for pipeline ① the dehydrate tool writes the
 * row carrying only the title (status="fetched"). `rewriteStatus` is the
 * output row's own status (the only signal that matters for "prose ready").
 */
export interface ChapterProgress {
  /** REWRITE OUTPUT sequential number (reader spine). */
  chapterNumber: number;
  title: string | null;
  sourceStatus: SourceChapterStatus | null;
  rewriteStatus: RewrittenChapterStatus | null;
}

/** Single-output detail: progress + the rewritten prose (null unless rewritten). */
export interface ChapterDetail extends ChapterProgress {
  content: string | null;
}

/**
 * Which of the three pipelines owns a thread — the message-vocabulary selector.
 * Mirrors `pipelineForConfig`'s branching but returns a tag instead of a
 * scheduler instance (the routes need the tag for status derivation without
 * pulling the schedulers into the shared layer).
 */
export type ChapterPipeline = "file" | "internet" | "nonNovel";

/**
 * Reader-facing per-chapter DotMatrix state. Values deliberately match DotMatrix
 * state names so `ChapterStatus.phase` renders with no client mapping:
 *   - `loading`  acquiring 原文 (sourceStatus "fetching") — pipelines ②/③ only;
 *                pipeline ① never fetches (it reads decoded text straight from
 *                `entertainment_configs.rawText`), so this state is unreachable
 *                for file-chaptered threads.
 *   - `syncing`  rewriting 重写 (rewriteStatus "rewriting").
 *   - `error`    source or rewrite failed — terminal until Redo.
 *   - `success`  rewritten — ready to read.
 *   - `paused`   scheduled (auto lookahead OR manual Process/Redo), waiting.
 *   - `stopped`  either user-stopped (the persisted `stopStatus` flag is set)
 *                or simply not yet scheduled (no row, not in the inFlight set).
 *                `ChapterStatus.messageKey` disambiguates the two for the user.
 */
export type ChapterPhase =
  | "loading"
  | "syncing"
  | "error"
  | "success"
  | "paused"
  | "stopped";

/**
 * Reader-facing per-chapter status — the single source the renderer renders from.
 * Derived on the backend (in the REST routes) per chapter and sent to the
 * renderer as a plain field. Carries everything the UI needs to show an
 * accurate, pipeline-aware message:
 *   - `phase`         DotMatrix state (drives the indicator animation/glyph).
 *   - `messageKey`    i18n key under `reader.status.{pipeline}.*` for the text.
 *   - `messageParams` optional interpolation params (e.g. `{ n: chapterNumber }`).
 *
 * The renderer NEVER maps status→message itself — it renders `phase` via
 * DotMatrix and `t(messageKey, messageParams)` for the copy. Because the backend
 * owns the whole derivation, the TOC, the footer's next-chapter indicator, and
 * the chapter body all read from the same source and can never disagree.
 */
export interface ChapterStatus {
  phase: ChapterPhase;
  messageKey: string;
  messageParams?: Record<string, string | number>;
}

/**
 * Derive a chapter's reader-facing status from its DB lifecycle statuses plus
 * the thread's scheduling context. Pure — the single source of the
 * status→indicator+message mapping, run on the backend; the renderer never maps.
 *
 * Inputs:
 *   - `ch`         the chapter's progress (source/rewrite statuses).
 *   - `inFlight`   the scheduler's snapshot of chapter numbers currently
 *                  enqueued-or-running. Covers both the auto-lookahead
 *                  (`ensureRange`) and manual "Process next N / all / Redo"
 *                  (`retryFailed`) paths — all funnel through `enqueue` →
 *                  `inFlight.add`; a chapter leaves the set only when its job
 *                  finishes.
 *   - `stopStatus` the thread's persisted stop intent. When `"stopped"`, a
 *                  not-yet-done chapter renders the explicit "stopped by user"
 *                  state (distinct from "not yet scheduled") and points the user
 *                  at Process to resume. Cleared only by an explicit user "go".
 *   - `pipeline`   which pipeline owns the thread — selects the message
 *                  vocabulary so each pipeline shows accurate copy (e.g.
 *                  pipeline ① "Rewriting chapter N…" never "Fetching…").
 *
 * Priority order (first match wins): terminal error → done → actively working
 * (rewriting/fetching) → queued (inFlight) → user-stopped → pending.
 */
export function deriveChapterStatus(
  ch: ChapterProgress,
  ctx: {
    inFlight: Set<number>;
    stopStatus: StopStatus | null;
    pipeline: ChapterPipeline;
  },
): ChapterStatus {
  const n = ch.chapterNumber;
  const p = ctx.pipeline;
  // 1. Terminal failure (source OR rewrite errored) — only Redo re-enqueues.
  if (ch.sourceStatus === "error" || ch.rewriteStatus === "error") {
    return { phase: "error", messageKey: `reader.status.${p}.error` };
  }
  // 2. Done — rewritten prose is ready to read.
  if (ch.rewriteStatus === "rewritten") {
    return { phase: "success", messageKey: `reader.status.${p}.success` };
  }
  // 3. Actively rewriting (the in-flight agent is producing the prose).
  if (ch.rewriteStatus === "rewriting") {
    return {
      phase: "syncing",
      messageKey: `reader.status.${p}.rewriting`,
      messageParams: { n },
    };
  }
  // 4. Actively acquiring 原文 (pipelines ②/③-internet only — pipeline ① has no
  //    fetch step; its source row is written title-only with status="fetched").
  if (ch.sourceStatus === "fetching") {
    return {
      phase: "loading",
      messageKey: `reader.status.${p}.fetching`,
      messageParams: { n },
    };
  }
  // 5. Queued — scheduled (lookahead or manual Process/Redo) but not started.
  if (ctx.inFlight.has(n)) {
    return {
      phase: "paused",
      messageKey: `reader.status.${p}.queued`,
      messageParams: { n },
    };
  }
  // 6. Not scheduled. If the user explicitly stopped the thread, show the
  //    resume guidance; otherwise this chapter just hasn't been reached yet.
  if (ctx.stopStatus === "stopped") {
    return { phase: "stopped", messageKey: `reader.status.${p}.stopped` };
  }
  return {
    phase: "stopped",
    messageKey: `reader.status.${p}.pending`,
  };
}

/**
 * Resolve which pipeline owns a thread from its config — the message-vocabulary
 * selector used by status derivation. Mirrors `pipelineForConfig`'s branching
 * (in pipelineRouter.ts) but returns the tag instead of a scheduler instance.
 * Non-dehydrate / missing config resolves to `"file"` as a harmless default
 * (status derivation is read-only; a mis-typed pipeline only affects copy).
 */
export function resolvePipelineType(
  config: EntertainmentConfig | null,
): ChapterPipeline {
  if (!config || config.mode !== "dehydrate") return "file";
  if (config.options.nonNovelSource) return "nonNovel";
  if (config.novel.type === "file") return "file";
  return "internet";
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
