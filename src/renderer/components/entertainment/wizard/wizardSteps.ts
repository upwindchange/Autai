import type {
  CrossChapterDehydrate,
  CrossChapterTactics,
  DehydrateBasic,
  DehydrateConfig,
  DehydrateDepth,
  EntertainmentConfig,
  EntertainmentMode,
  LanguageAdaptation,
  SituationDehydrate,
  SituationTactics,
} from "@shared";
import { fillCrossChapterTactics, fillSituationTactics } from "@shared";

/**
 * Pure helpers for the entertainment wizard: initial configs, mode/novel
 * transitions, per-step validation, and a mode-narrowed options patcher.
 *
 * The in-progress config is the strict `EntertainmentConfig` discriminated
 * union. Spreading a union widens the `mode` discriminant, so every mutation
 * narrows on `mode` first (see `patchSharedOptions` / `swapMode`).
 */

export const DEFAULT_BASIC: DehydrateBasic = {
  grammarFix: true,
  webSlangFilter: true,
};

// 情境脱水 default: medium strength, all tactics OFF (opt-in per tactic).
export const DEFAULT_SITUATION: SituationDehydrate = {
  strength: 2,
  tactics: fillSituationTactics(false),
};

// 章节并写 mirrors 情境脱水: medium strength, all tactics OFF (opt-IN per tactic).
// Honored by the multi rewriter (file-pipeline merges) only.
export const DEFAULT_CROSS_CHAPTER: CrossChapterDehydrate = {
  strength: 2,
  tactics: fillCrossChapterTactics(false),
};

// Rewrite-intensity (depth) defaults: both ON at 中 (medium), opt-out per category.
export const DEFAULT_DEPTH: DehydrateDepth = {
  prosePolish: { enabled: true, level: 2 },
  proseExpand: { enabled: true, level: 2 },
};

// Language adaptation defaults to all-off; translation is rarely wanted.
export const DEFAULT_LANGUAGE: LanguageAdaptation = {
  targetLanguage: "",
  translate: { enabled: false },
  nameLocalization: { enabled: false },
  dialogueSubject: { enabled: false },
};

export const INITIAL_DEHYDRATE: DehydrateConfig = {
  mode: "dehydrate",
  novel: { type: "internet", title: "", source: "" },
  options: {
    basic: { ...DEFAULT_BASIC },
    situation: structuredClone(DEFAULT_SITUATION),
    crossChapter: structuredClone(DEFAULT_CROSS_CHAPTER),
    depth: structuredClone(DEFAULT_DEPTH),
    language: structuredClone(DEFAULT_LANGUAGE),
    nonNovelSource: false,
    customInstruction: "",
  },
};

/**
 * Switch the top-level mode. Carries the shared `basic` + `situation` +
 * `crossChapter` + `depth` + `language` + `customInstruction` options over (all
 * modes have them) and resets `novel` to a valid shape for the new mode:
 * audiobook ⇒ file; dehydrate ⇒ internet form.
 */
export function swapMode(
  config: EntertainmentConfig,
  mode: EntertainmentMode,
): EntertainmentConfig {
  if (config.mode === mode) return config;
  // All modes share basic + situation + crossChapter + depth + language +
  // nonNovelSource + customInstruction, so they survive the swap unchanged.
  const basic = config.options.basic;
  const situation = config.options.situation;
  const crossChapter = config.options.crossChapter;
  const depth = config.options.depth;
  const language = config.options.language;
  const nonNovelSource = config.options.nonNovelSource;
  const customInstruction = config.options.customInstruction;
  switch (mode) {
    case "audiobook":
      return {
        mode: "audiobook",
        novel: { type: "file", filename: "" },
        options: {
          basic,
          situation,
          crossChapter,
          depth,
          language,
          nonNovelSource,
          customInstruction,
        },
      };
    case "dehydrate":
      return {
        mode: "dehydrate",
        novel: { type: "internet", title: "", source: "" },
        options: {
          basic,
          situation,
          crossChapter,
          depth,
          language,
          nonNovelSource,
          customInstruction,
        },
      };
    // Future modes fall through unchanged rather than producing an invalid
    // config; the caller can add a dedicated case when a new mode lands.
    default:
      return config;
  }
}

/** Per-key depth patch: each field is `{ enabled, level }`. */
type DepthPatch = Partial<
  Record<keyof DehydrateDepth, Partial<{ enabled: boolean; level: number }>>
>;

/** Language patch: targetLanguage + each toggle, each independently optional. */
type LanguagePatch = {
  targetLanguage?: string;
  translate?: Partial<{ enabled: boolean }>;
  nameLocalization?: Partial<{ enabled: boolean }>;
  dialogueSubject?: Partial<{ enabled: boolean }>;
};

/**
 * Patch for a `{ strength, tactics }` dehydration block (情境脱水 / 章节并写):
 * the strength dial and/or a per-tactic merge. `strength` replaces outright;
 * `tactics` is merged per key so toggling one tactic can't drop the others (and
 * the master switch passes every tactic key at once).
 */
interface DehydrateBlockPatch<Tactics> {
  strength?: number;
  tactics?: Partial<Tactics>;
}

type SituationPatch = DehydrateBlockPatch<SituationTactics>;
type CrossChapterPatch = DehydrateBlockPatch<CrossChapterTactics>;

/**
 * Merge a `{ strength, tactics }` dehydration block. Shared by 情境脱水 and
 * 章节并写 (identical shape, different tactic sets). Tactics are merged per key
 * so each stays `boolean`, not `boolean | undefined`.
 */
function mergeDehydrateBlock<
  T extends { strength: number; tactics: Record<string, boolean> },
>(base: T, blockPatch: DehydrateBlockPatch<T["tactics"]>): T {
  // Spread + cast preserves the concrete `T["tactics"]` (e.g. SituationTactics)
  // so per-key writes stay type-safe rather than widening to Record<string, boolean>.
  const tactics = { ...base.tactics } as T["tactics"];
  if (blockPatch.tactics) {
    for (const key of Object.keys(
      blockPatch.tactics,
    ) as (keyof T["tactics"])[]) {
      const v = blockPatch.tactics[key];
      if (v !== undefined) tactics[key] = v;
    }
  }
  return {
    ...base,
    strength:
      blockPatch.strength !== undefined ? blockPatch.strength : base.strength,
    tactics,
  };
}

/**
 * Patch the shared Module-1 (basic) / Module-1b (situation) / Module-1c
 * (crossChapter) / Module-2 (depth) / Module-3 (language) options, plus the
 * free-form `customInstruction`. Mode is narrowed per branch so the spread
 * keeps the `mode` discriminant literal. Any subset may be passed.
 *
 * Depth and language are merged per key: a depth patch of `{ enabled }` must not
 * clobber the existing `level`, and a language toggle patch of `{ enabled }`
 * must not drop other toggles.
 */
export function patchSharedOptions(
  prev: EntertainmentConfig,
  patch: {
    basic?: Partial<DehydrateBasic>;
    situation?: SituationPatch;
    crossChapter?: CrossChapterPatch;
    depth?: DepthPatch;
    language?: LanguagePatch;
    nonNovelSource?: boolean;
    customInstruction?: string;
  },
): EntertainmentConfig {
  const mergeDepth = (
    base: DehydrateDepth,
    depthPatch: DepthPatch,
  ): DehydrateDepth => {
    const out = { ...base };
    for (const key of Object.keys(depthPatch) as (keyof DehydrateDepth)[]) {
      out[key] = { ...base[key], ...depthPatch[key] };
    }
    return out;
  };

  const LANGUAGE_TOGGLE_KEYS = [
    "translate",
    "nameLocalization",
    "dialogueSubject",
  ] as const;

  const mergeLanguage = (
    base: LanguageAdaptation,
    langPatch: LanguagePatch,
  ): LanguageAdaptation => {
    const out = { ...base };
    if (langPatch.targetLanguage !== undefined) {
      out.targetLanguage = langPatch.targetLanguage;
    }
    for (const key of LANGUAGE_TOGGLE_KEYS) {
      if (langPatch[key] !== undefined) {
        out[key] = { ...base[key], ...langPatch[key] };
      }
    }
    return out;
  };

  // Both modes carry structurally identical options (see
  // DehydrateConfigSchema / AudiobookConfigSchema), so one merge serves both —
  // the spread keeps the `mode` discriminant literal intact.
  return {
    ...prev,
    options: {
      ...prev.options,
      ...(patch.basic ?
        { basic: { ...prev.options.basic, ...patch.basic } }
      : {}),
      ...(patch.situation ?
        {
          situation: mergeDehydrateBlock(
            prev.options.situation,
            patch.situation,
          ),
        }
      : {}),
      ...(patch.crossChapter ?
        {
          crossChapter: mergeDehydrateBlock(
            prev.options.crossChapter,
            patch.crossChapter,
          ),
        }
      : {}),
      ...(patch.depth ?
        { depth: mergeDepth(prev.options.depth, patch.depth) }
      : {}),
      ...(patch.language ?
        { language: mergeLanguage(prev.options.language, patch.language) }
      : {}),
      ...(patch.nonNovelSource !== undefined ?
        { nonNovelSource: patch.nonNovelSource }
      : {}),
      ...(patch.customInstruction !== undefined ?
        { customInstruction: patch.customInstruction }
      : {}),
    },
  };
}

export function isStepValid(
  step: number,
  config: EntertainmentConfig,
  modelsConfigured = true,
): boolean {
  switch (step) {
    case 0:
      // Mode itself is always set, but both agent models must resolve to a
      // configured (provider, model) pair before the user can advance.
      return modelsConfigured;
    case 1: {
      // novel
      if (config.novel.type === "file") return config.novel.filename.length > 0;
      // internet: source is always required; the title is required only when
      // the source IS a chaptered novel (when nonNovelSource is on, the title
      // field is disabled in the UI and the schema allows it empty).
      const titleOk =
        config.options.nonNovelSource || config.novel.title.trim().length > 0;
      // Start chapter (chaptered internet only): unset = 1; set = a positive
      // integer. A NaN (non-numeric input sneaking past the number field)
      // blocks advance here and fails the backend schema as a second line.
      const start = config.novel.startChapterNumber;
      const startOk =
        start === undefined || (Number.isInteger(start) && start >= 1);
      return titleOk && startOk && config.novel.source.trim().length > 0;
    }
    case 2: {
      // Translation target language is required when translate is on.
      const { translate, targetLanguage } = config.options.language;
      if (translate.enabled && targetLanguage.trim().length === 0) {
        return false;
      }
      return true;
    }
    default:
      return false;
  }
}

/** Whether 章节并写 is available — for any local file upload (chaptered or
 * not): the multi runner re-chapters from the text itself and judges the
 * cross-chapter tactics across its output chapters either way. */
export function isCrossChapterAvailable(config: EntertainmentConfig): boolean {
  return config.novel.type === "file";
}
