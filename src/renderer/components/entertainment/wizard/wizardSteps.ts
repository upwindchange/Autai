import type {
  CrossChapterDehydrate,
  CrossChapterTactics,
  DehydrateBasic,
  DehydrateConfig,
  DehydrateDepth,
  EntertainmentConfig,
  EntertainmentMode,
  InteractiveConfig,
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

// 情境脱水 ships active: medium strength, every tactic on (opt-OUT per tactic).
export const DEFAULT_SITUATION: SituationDehydrate = {
  strength: 2,
  tactics: fillSituationTactics(true),
};

// 章节并写 ships active too (medium strength, all tactics on), mirroring 情境脱水.
// The backend accepts this but does not yet act on it — see
// `CrossChapterTacticsSchema` in the shared schema.
export const DEFAULT_CROSS_CHAPTER: CrossChapterDehydrate = {
  strength: 2,
  tactics: fillCrossChapterTactics(true),
};

// Rewrite-intensity aspects default OFF — the user opts into each enhancement.
// (脱水提速 is not here; it's the situational block's `strength` dial.)
export const DEFAULT_DEPTH: DehydrateDepth = {
  dialoguePacing: { enabled: false, level: 2 },
  sceneEnhance: { enabled: false, level: 2 },
  combatEnhance: { enabled: false, level: 2 },
  emotionEnhance: { enabled: false, level: 2 },
  literaryEnhance: { enabled: false, level: 2 },
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

export const INITIAL_INTERACTIVE: InteractiveConfig = {
  mode: "interactive",
  // interactive accepts a text file only
  novel: { type: "file", filename: "" },
  options: {
    interactionFrequency: 2,
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
 * interactive ⇒ text file only; dehydrate ⇒ internet form.
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
    case "interactive":
      return {
        mode: "interactive",
        novel: { type: "file", filename: "" },
        options: {
          interactionFrequency: 2,
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
  classicalToModern?: Partial<{ enabled: boolean }>;
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
function mergeDehydrateBlock<T extends { strength: number; tactics: Record<string, boolean> }>(
  base: T,
  blockPatch: DehydrateBlockPatch<T["tactics"]>,
): T {
  // Spread + cast preserves the concrete `T["tactics"]` (e.g. SituationTactics)
  // so per-key writes stay type-safe rather than widening to Record<string, boolean>.
  const tactics = { ...base.tactics } as T["tactics"];
  if (blockPatch.tactics) {
    for (const key of Object.keys(blockPatch.tactics) as (keyof T["tactics"])[]) {
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
  const mergeDepth = (base: DehydrateDepth, depthPatch: DepthPatch): DehydrateDepth => {
    const out = { ...base };
    for (const key of Object.keys(depthPatch) as (keyof DehydrateDepth)[]) {
      out[key] = { ...base[key], ...depthPatch[key] };
    }
    return out;
  };

  const LANGUAGE_TOGGLE_KEYS = [
    "translate",
    "nameLocalization",
    "classicalToModern",
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

  if (prev.mode === "dehydrate") {
    return {
      ...prev,
      options: {
        ...prev.options,
        ...(patch.basic ?
          { basic: { ...prev.options.basic, ...patch.basic } }
        : {}),
        ...(patch.situation ?
          {
            situation: mergeDehydrateBlock(prev.options.situation, patch.situation),
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
  return {
    ...prev,
    options: {
      ...prev.options,
      ...(patch.basic ?
        { basic: { ...prev.options.basic, ...patch.basic } }
      : {}),
      ...(patch.situation ?
        {
          situation: mergeDehydrateBlock(prev.options.situation, patch.situation),
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
      ...(patch.customInstruction !== undefined ?
        { customInstruction: patch.customInstruction }
      : {}),
    },
  };
}

export function isStepValid(
  step: number,
  config: EntertainmentConfig,
): boolean {
  switch (step) {
    case 0:
      return true; // mode always set
    case 1: {
      // novel
      if (config.novel.type === "file") return config.novel.filename.length > 0;
      // internet: source is always required; the title is required only when
      // the source IS a chaptered novel (when nonNovelSource is on, the title
      // field is disabled in the UI and the schema allows it empty).
      const titleOk =
        config.options.nonNovelSource || config.novel.title.trim().length > 0;
      return titleOk && config.novel.source.trim().length > 0;
    }
    case 2: {
      // Options always have valid defaults, except the translation target
      // language — required when translate is on, because the rewrite prompt
      // assumes a non-empty target and skips the empty-target path.
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

/**
 * Whether 章节并写 (cross-chapter processing) is available for this config.
 * Cross-chapter awareness needs fast random access to ALL chapters' content at
 * rewrite time — only a locally uploaded text file gives the agent that. The
 * internet-fetch path streams one chapter at a time over the network (no
 * cross-chapter context), and a non-chaptered source (`nonNovelSource`) is a
 * single continuous text with no chapters to be aware of in the first place.
 * The UI uses this to grey out the 章节并写 block and show an explanation.
 */
export function isCrossChapterAvailable(
  config: EntertainmentConfig,
): boolean {
  return config.novel.type === "file" && !config.options.nonNovelSource;
}
