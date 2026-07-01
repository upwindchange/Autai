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
  // 1 = light · 2 = medium · 3 = heavy — default to a balanced medium pass.
  dialoguePacing: 2,
  dehydrate: 2,
  sceneEnhance: 2,
  combatEnhance: 2,
  emotionEnhance: 2,
  literaryEnhance: 2,
};

export const INITIAL_DEHYDRATE: DehydrateConfig = {
  mode: "dehydrate",
  novel: { type: "internet", title: "", source: "" },
  options: {
    basic: { ...DEFAULT_BASIC },
    depth: { ...DEFAULT_DEPTH },
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
    depth: { ...DEFAULT_DEPTH },
    customInstruction: "",
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
  // Both modes share basic + depth + customInstruction, so they survive the
  // swap unchanged.
  const basic = config.options.basic;
  const depth = config.options.depth;
  const customInstruction = config.options.customInstruction;
  switch (mode) {
    case "interactive":
      return {
        mode: "interactive",
        novel: { type: "file", filename: "" },
        options: { interactionFrequency: 2, basic, depth, customInstruction },
      };
    case "dehydrate":
      return {
        mode: "dehydrate",
        novel: { type: "internet", title: "", source: "" },
        options: { basic, depth, customInstruction },
      };
    // Future modes fall through unchanged rather than producing an invalid
    // config; the caller can add a dedicated case when a new mode lands.
    default:
      return config;
  }
}

/**
 * Patch the shared Module-1 (basic) / Module-2 (depth) options, plus the
 * free-form `customInstruction`. Mode is narrowed per branch so the spread
 * keeps the `mode` discriminant literal. Any subset of the three may be passed.
 */
export function patchSharedOptions(
  prev: EntertainmentConfig,
  patch: {
    basic?: Partial<DehydrateBasic>;
    depth?: Partial<DehydrateDepth>;
    customInstruction?: string;
  },
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
        { depth: { ...prev.options.depth, ...patch.depth } }
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
