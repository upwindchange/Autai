/**
 * Provider and model types driven by TOML configuration files.
 * These types replace the old hardcoded discriminated union provider types.
 */

import { z } from "zod";

// ──────────────────────────────────────────────
// Provider definition (read from provider.toml, read-only catalog data)
// ──────────────────────────────────────────────

export const ProviderDefinitionSchema = z.object({
  dir: z.string(), // folder name: "anthropic", "zhipuai-coding-plan"
  name: z.string(), // display name: "Anthropic", "Zhipu AI Coding Plan"
  env: z.array(z.string()), // required env vars: ["ANTHROPIC_API_KEY"]
  npm: z.string(), // SDK package: "@ai-sdk/anthropic"
  api: z.string().optional(), // default base URL (for openai-compatible)
  doc: z.string(), // documentation URL
  logo: z.string().optional(), // inline SVG markup (uses fill="currentColor")
});
export type ProviderDefinition = z.infer<typeof ProviderDefinitionSchema>;

// ──────────────────────────────────────────────
// Model definition (read from models/*.toml)
// ──────────────────────────────────────────────

export const ModelCostSchema = z.object({
  input: z.number(),
  output: z.number(),
  cacheRead: z.number().optional(),
  cacheWrite: z.number().optional(),
  cachedInput: z.number().optional(),
});
export type ModelCost = z.infer<typeof ModelCostSchema>;

export const ModelLimitSchema = z.object({
  context: z.number(),
  output: z.number(),
});
export type ModelLimit = z.infer<typeof ModelLimitSchema>;

export const ModelModalitiesSchema = z.object({
  input: z.array(z.string()),
  output: z.array(z.string()),
});
export type ModelModalities = z.infer<typeof ModelModalitiesSchema>;

/**
 * Reasoning control a model exposes to callers. Mirrors the models.dev catalog
 * discriminated union (`reference/models.dev/packages/core/src/schema.ts`). An
 * empty `reasoning_options = []` (always-on, no caller control) is represented
 * by the model having `reasoningOptions: []`; absence of the field means the
 * model has no reasoning support surfaced and the UI renders nothing.
 *
 * Three primitive option types may co-exist on one model (e.g. Claude Opus 4.5
 * declares both `effort` and `budget_tokens`).
 */
export const ReasoningOptionSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("toggle"),
    })
    .strict(),
  z
    .object({
      type: z.literal("effort"),
      // null ≡ "default" in the catalog vocabulary.
      values: z.array(z.string().nullable()),
    })
    .strict(),
  z
    .object({
      type: z.literal("budget_tokens"),
      min: z.number().optional(),
      max: z.number().optional(),
    })
    .strict(),
]);
export type ReasoningOption = z.infer<typeof ReasoningOptionSchema>;

export const ModelDefinitionSchema = z.object({
  name: z.string(), // display name: "Claude Sonnet 4.6"
  file: z.string(), // filename stem: "claude-sonnet-4-6"
  family: z.string().optional(),
  attachment: z.boolean().optional(),
  reasoning: z.boolean().optional(),
  reasoningOptions: z.array(ReasoningOptionSchema).optional(),
  temperature: z.boolean().optional(),
  toolCall: z.boolean().optional(),
  structuredOutput: z.boolean().optional(),
  knowledge: z.string().optional(),
  openWeights: z.boolean().optional(),
  cost: ModelCostSchema.optional(),
  limit: ModelLimitSchema.optional(),
  modalities: ModelModalitiesSchema.optional(),
  interleaved: z
    .object({
      field: z.string(),
    })
    .optional(),
});
export type ModelDefinition = z.infer<typeof ModelDefinitionSchema>;

// ──────────────────────────────────────────────
// User provider config (stored in SQLite)
// ──────────────────────────────────────────────

export const UserProviderConfigSchema = z.object({
  id: z.string().min(1),
  providerDir: z.string().min(1), // references ProviderDefinition.dir
  apiKey: z.string().default(""),
  apiUrlOverride: z.string().optional(), // user override of TOML default
  npm: z.string(), // SDK package: "@ai-sdk/anthropic" — persisted from TOML at save time
  defaultApiUrl: z.string().optional(), // default base URL from TOML — persisted at save time
});
export type UserProviderConfig = z.infer<typeof UserProviderConfigSchema>;

// ──────────────────────────────────────────────
// Model parameters (stored as JSON TEXT in SQLite)
// ──────────────────────────────────────────────

export const ModelParametersSchema = z.object({
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).optional(),
  topP: z.number().min(0).max(1).optional(),
  topK: z.number().int().min(1).optional(),
  frequencyPenalty: z.number().min(-2).max(2).optional(),
  presencePenalty: z.number().min(-2).max(2).optional(),
  stopSequences: z.array(z.string()).max(4).optional(),
  /**
   * Reasoning selection, expressed in catalog vocabulary (provider-agnostic).
   * The translator in providers/index.ts maps these into the SDK-specific
   * providerOptions shape. All three are nullable so the user can distinguish
   * "unset" (use model default) from an explicit choice.
   *
   *  - reasoningEnabled: explicit on/off when the model offers a toggle.
   *    `false` is the DeepSeek fix — emits thinking.type = "disabled".
   *  - reasoningEffort: one of the model's declared effort values.
   *  - reasoningBudgetTokens: token budget when the model offers budget_tokens.
   */
  reasoningEnabled: z.boolean().nullable().optional(),
  reasoningEffort: z.string().nullable().optional(),
  reasoningBudgetTokens: z.number().int().min(1).nullable().optional(),
});
export type ModelParameters = z.infer<typeof ModelParametersSchema>;

// ──────────────────────────────────────────────
// Model role assignment (stored in SQLite)
// ──────────────────────────────────────────────

export const ModelRoleSchema = z.enum(["chat", "simple", "complex"]);
export type ModelRole = z.infer<typeof ModelRoleSchema>;

export const ModelRoleAssignmentSchema = z.object({
  role: ModelRoleSchema,
  providerId: z.string(),
  modelId: z.string(),
  params: ModelParametersSchema.optional(),
});
export type ModelRoleAssignment = z.infer<typeof ModelRoleAssignmentSchema>;

/**
 * Manual capability override for a (provider, model) pair whose catalog has no
 * `limit` — the openai-compatible case (no TOML on disk; the model list is
 * fetched live from the user's endpoint with no context/output metadata).
 *
 * The frontend owns the 128k default: it persists a concrete value before the
 * number ever reaches the backend, so `contextWindow` reaching the model
 * factory is always defined for openai-compatible models. A TOML provider whose
 * model file is *itself* missing `limit` is the one and only backend fallback
 * (to FALLBACK_CONTEXT_TOKENS, with a warning) — see providers/index.ts.
 *
 * Keyed by (providerId, modelId) rather than role: a capability fact belongs to
 * the model, and the same model may serve multiple roles.
 */
export const ModelOverrideSchema = z.object({
  providerId: z.string(),
  modelId: z.string(),
  contextWindow: z.number().int().min(1).optional(),
  maxOutputTokens: z.number().int().min(1).optional(),
});
export type ModelOverride = z.infer<typeof ModelOverrideSchema>;

// ──────────────────────────────────────────────
// Test connection config (flat, no discriminated union)
// ──────────────────────────────────────────────

export const TestConnectionConfigSchema = z.object({
  providerDir: z.string().min(1),
  apiKey: z.string().min(1),
  apiUrlOverride: z.string().optional(),
  modelId: z.string().min(1),
  npm: z.string(),
  defaultApiUrl: z.string().optional(),
});
export type TestConnectionConfig = z.infer<typeof TestConnectionConfigSchema>;

// ──────────────────────────────────────────────
// Runtime config for Provider class (derived from DB, not persisted separately)
// ──────────────────────────────────────────────

export interface ProviderRuntimeConfig {
  npm: string;
  defaultApiUrl?: string;
  name: string;
}
