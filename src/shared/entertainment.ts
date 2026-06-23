import { z } from "zod";

/**
 * Entertainment-mode configuration contract.
 *
 * The wizard (renderer) serializes an `EntertainmentConfig` as a JSON text
 * message via `aui.thread().append()`. The backend route parses the last user
 * message's text part with `EntertainmentConfigSchema` and routes on `mode`.
 *
 * Key shapes:
 *   - `mode` discriminates the top-level union (drives the exhaustive `switch`
 *     in EntertainmentWorker).
 *   - `novel` is mode-dependent: `dehydrate` accepts file OR internet;
 *     `interactive` accepts a text file ONLY.
 *   - Both modes share Module 1 (basic toggles) + Module 2 (depth sliders).
 *     `interactive` additionally carries `interactionFrequency`.
 */

// --- Novel inputs ----------------------------------------------------------

const FileNovelSchema = z.object({
  type: z.literal("file"),
  filename: z.string().min(1),
  // native-picker only: lets a future "show in folder" affordance work.
  fsPath: z.string().optional(),
});

const InternetNovelSchema = z.object({
  type: z.literal("internet"),
  title: z.string().trim().min(1),
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
  preachRemoval: z.boolean().default(false),
});

/** Module 2 — 深度重写 (1–5 intensity sliders). */
const DehydrateDepthSchema = z.object({
  dialoguePacing: z.number().int().min(1).max(5).default(3),
  dehydrate: z.number().int().min(1).max(5).default(3),
  sceneEnhance: z.number().int().min(1).max(5).default(3),
  combatEnhance: z.number().int().min(1).max(5).default(3),
  emotionEnhance: z.number().int().min(1).max(5).default(3),
  literaryEnhance: z.number().int().min(1).max(5).default(3),
});

/** Interactive-only option. */
const InteractiveOptionsSchema = z.object({
  interactionFrequency: z.number().int().min(1).max(3).default(2),
});

// --- Per-mode configs ------------------------------------------------------

export const DehydrateConfigSchema = z.object({
  mode: z.literal("dehydrate"),
  novel: NovelInputSchema, // file | internet
  options: z.object({
    basic: DehydrateBasicSchema,
    depth: DehydrateDepthSchema,
  }),
});

export const InteractiveConfigSchema = z.object({
  mode: z.literal("interactive"),
  novel: FileNovelSchema, // interactive accepts a text file ONLY
  // Composes all three: interactionFrequency + Module 1 + Module 2.
  options: InteractiveOptionsSchema.extend({
    basic: DehydrateBasicSchema,
    depth: DehydrateDepthSchema,
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
export type DehydrateBasic = z.infer<typeof DehydrateBasicSchema>;
export type DehydrateDepth = z.infer<typeof DehydrateDepthSchema>;
