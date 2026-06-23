import type {
  DehydrateBasic,
  DehydrateConfig,
  DehydrateDepth,
  EntertainmentConfig,
  EntertainmentMode,
  InteractiveConfig,
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

export const DEFAULT_DEPTH: DehydrateDepth = {
  dialoguePacing: 3,
  dehydrate: 3,
  sceneEnhance: 3,
  combatEnhance: 3,
  emotionEnhance: 3,
  literaryEnhance: 3,
};

export const INITIAL_DEHYDRATE: DehydrateConfig = {
  mode: "dehydrate",
  novel: { type: "internet", title: "", source: "" },
  options: { basic: { ...DEFAULT_BASIC }, depth: { ...DEFAULT_DEPTH } },
};

export const INITIAL_INTERACTIVE: InteractiveConfig = {
  mode: "interactive",
  // interactive accepts a text file only
  novel: { type: "file", filename: "" },
  options: {
    interactionFrequency: 2,
    basic: { ...DEFAULT_BASIC },
    depth: { ...DEFAULT_DEPTH },
  },
};

/**
 * Switch the top-level mode. Carries the shared `basic` + `depth` options over
 * (both modes have them) and resets `novel` to a valid shape for the new mode:
 * interactive ⇒ text file only; dehydrate ⇒ internet form.
 */
export function swapMode(
  config: EntertainmentConfig,
  mode: EntertainmentMode,
): EntertainmentConfig {
  if (config.mode === mode) return config;
  // Both modes share basic + depth, so they survive the swap unchanged.
  const basic = config.options.basic;
  const depth = config.options.depth;
  if (mode === "interactive") {
    return {
      mode: "interactive",
      novel: { type: "file", filename: "" },
      options: { interactionFrequency: 2, basic, depth },
    };
  }
  return {
    mode: "dehydrate",
    novel: { type: "internet", title: "", source: "" },
    options: { basic, depth },
  };
}

/**
 * Patch the shared Module-1 (basic) / Module-2 (depth) options. Mode is narrowed
 * per branch so the spread keeps the `mode` discriminant literal. Only one of
 * `basic` / `depth` is patched per call.
 */
export function patchSharedOptions(
  prev: EntertainmentConfig,
  patch: { basic?: Partial<DehydrateBasic>; depth?: Partial<DehydrateDepth> },
): EntertainmentConfig {
  if (prev.mode === "dehydrate") {
    return {
      ...prev,
      options: {
        ...prev.options,
        ...(patch.basic ?
          { basic: { ...prev.options.basic, ...patch.basic } }
        : {}),
        ...(patch.depth ?
          { depth: { ...prev.options.depth, ...patch.depth } }
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
        { depth: { ...prev.options.depth, ...patch.depth } }
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
