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

export const ModelDefinitionSchema = z.object({
  name: z.string(), // display name: "Claude Sonnet 4.6"
  file: z.string(), // filename stem: "claude-sonnet-4-6"
  family: z.string().optional(),
  attachment: z.boolean().optional(),
  reasoning: z.boolean().optional(),
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
