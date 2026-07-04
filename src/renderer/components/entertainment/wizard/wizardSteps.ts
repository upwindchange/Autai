import type {
  DehydrateBasic,
  DehydrateConfig,
  DehydrateDepth,
  EntertainmentConfig,
  EntertainmentMode,
  InteractiveConfig,
  LanguageAdaptation,
} from "@shared";

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
  preachRemoval: false,
};

// 1 = light · 2 = medium · 3 = heavy — default to a balanced medium pass, all on.
export const DEFAULT_DEPTH: DehydrateDepth = {
  dialoguePacing: { enabled: true, level: 2 },
  dehydrate: { enabled: true, level: 2 },
  sceneEnhance: { enabled: true, level: 2 },
  combatEnhance: { enabled: true, level: 2 },
  emotionEnhance: { enabled: true, level: 2 },
  literaryEnhance: { enabled: true, level: 2 },
};

// Language adaptation defaults to all-off; translation is rarely wanted.
export const DEFAULT_LANGUAGE: LanguageAdaptation = {
  targetLanguage: "",
  translate: { enabled: false },
  nameLocalization: { enabled: false },
  classicalToModern: { enabled: false },
  dialogueSubject: { enabled: false },
};

export const INITIAL_DEHYDRATE: DehydrateConfig = {
  mode: "dehydrate",
  novel: { type: "internet", title: "", source: "" },
  options: {
    basic: { ...DEFAULT_BASIC },
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
    depth: structuredClone(DEFAULT_DEPTH),
    language: structuredClone(DEFAULT_LANGUAGE),
    nonNovelSource: false,
    customInstruction: "",
  },
};

/**
 * Switch the top-level mode. Carries the shared `basic` + `depth` + `language` +
 * `customInstruction` options over (all modes have them) and resets `novel` to a
 * valid shape for the new mode: interactive ⇒ text file only; dehydrate ⇒
 * internet form.
 */
export function swapMode(
  config: EntertainmentConfig,
  mode: EntertainmentMode,
): EntertainmentConfig {
  if (config.mode === mode) return config;
  // All modes share basic + depth + language + nonNovelSource +
  // customInstruction, so they survive the swap unchanged.
  const basic = config.options.basic;
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
        options: { basic, depth, language, nonNovelSource, customInstruction },
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
 * Patch the shared Module-1 (basic) / Module-2 (depth) / Module-3 (language)
 * options, plus the free-form `customInstruction`. Mode is narrowed per branch
 * so the spread keeps the `mode` discriminant literal. Any subset may be passed.
 *
 * Depth and language are merged per key: a depth patch of `{ enabled }` must not
 * clobber the existing `level`, and a language toggle patch of `{ enabled }`
 * must not drop other toggles.
 */
export function patchSharedOptions(
  prev: EntertainmentConfig,
  patch: {
    basic?: Partial<DehydrateBasic>;
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
      return (
        config.novel.title.trim().length > 0 &&
        config.novel.source.trim().length > 0
      );
    }
    case 2:
      return true; // options always have valid defaults
    default:
      return false;
  }
}
