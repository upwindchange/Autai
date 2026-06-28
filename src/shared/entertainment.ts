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
 * Per-chapter pipeline progress — the reader's list/TOC view, merging the two
 * tables by chapterNumber. A `null` status means no row for that table yet
 * (the chapter hasn't been acquired/rewritten). No prose here; see ChapterDetail.
 */
export interface ChapterProgress {
  chapterNumber: number;
  title: string | null;
  sourceStatus: SourceChapterStatus | null;
  rewriteStatus: RewrittenChapterStatus | null;
}

/** Single-chapter detail: progress + the rewritten prose (null unless rewritten). */
export interface ChapterDetail extends ChapterProgress {
  content: string | null;
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
