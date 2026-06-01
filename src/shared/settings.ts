/**
 * Settings-related types shared between main and renderer processes.
 * Uses flat provider types driven by TOML files (see providers.ts).
 */

import { z } from "zod";
import {
  UserProviderConfigSchema,
  ModelRoleAssignmentSchema,
} from "./providers";

export type { UserProviderConfig, ModelRoleAssignment } from "./providers";
export type {
  ProviderDefinition,
  ModelDefinition,
  ModelRole,
} from "./providers";

// Re-export provider schemas for convenience
export {
  UserProviderConfigSchema,
  ModelRoleAssignmentSchema,
  ProviderDefinitionSchema,
  ModelDefinitionSchema,
  TestConnectionConfigSchema,
} from "./providers";

// Log level type
export const LogLevelSchema = z.enum([
  "error",
  "warn",
  "info",
  "verbose",
  "debug",
  "silly",
]);
export type LogLevel = z.infer<typeof LogLevelSchema>;

// Search engine type
export const SearchEngineSchema = z.enum([
  "google",
  "bing",
  "bingChina",
  "duckduckgo",
  "baidu",
  "sogou",
  "brave",
  "custom",
]);
export type SearchEngine = z.infer<typeof SearchEngineSchema>;

// Custom search engine configuration (used when searchEngine is "custom")
export const CustomSearchEngineSchema = z.object({
  name: z.string().min(1),
  urlTemplate: z.string().min(1),
});
export type CustomSearchEngine = z.infer<typeof CustomSearchEngineSchema>;

// Langfuse configuration schema
export const LangfuseConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    publicKey: z.string().optional(),
    secretKey: z.string().optional(),
    host: z.string().optional(),
  })
  .default({
    enabled: false,
    publicKey: undefined,
    secretKey: undefined,
    host: undefined,
  });

export type LangfuseConfig = z.infer<typeof LangfuseConfigSchema>;

// Timeout configuration schema (values in seconds, converted to ms internally)
export const TimeoutsConfigSchema = z.object({
  /** stepMs for chat + planning (seconds) */
  response: z.number().int().min(30).max(3600).default(300),
  /** stepMs for actionExecution (seconds) */
  action: z.number().int().min(30).max(3600).default(480),
  /** stepMs for hitlAgent (seconds) */
  interactive: z.number().int().min(30).max(3600).default(600),
  /** chunkMs for all agents (seconds) */
  streaming: z.number().int().min(30).max(3600).default(120),
});
export type TimeoutsConfig = z.infer<typeof TimeoutsConfigSchema>;

// Default model assignments (empty — user configures from catalog)
const DEFAULT_MODEL_ASSIGNMENT = {
  role: "chat" as const,
  providerId: "",
  modelId: "",
};

// Default settings
const DEFAULT_SETTINGS = {
  providers: [] as z.infer<typeof UserProviderConfigSchema>[],
  modelAssignments: {
    chat: DEFAULT_MODEL_ASSIGNMENT,
    simple: { ...DEFAULT_MODEL_ASSIGNMENT, role: "simple" as const },
    complex: { ...DEFAULT_MODEL_ASSIGNMENT, role: "complex" as const },
  },
  useSameModelForAgents: true,
  logLevel: "info" as const,
  langfuse: LangfuseConfigSchema.parse({}),
  autoTagEnabled: true,
  autoTagCreationEnabled: true,
  systemPrompt: "",
  language: "system" as const,
  maxParallelAgents: 2,
  maxRetries: 3,
  searchEngine: "google" as const,
  customSearchEngine: undefined,
  timeouts: TimeoutsConfigSchema.parse({}),
};

// Settings State schema
export const SettingsStateSchema = z
  .object({
    providers: z.array(UserProviderConfigSchema).default([]),
    modelAssignments: z
      .object({
        chat: ModelRoleAssignmentSchema,
        simple: ModelRoleAssignmentSchema,
        complex: ModelRoleAssignmentSchema,
      })
      .default(DEFAULT_SETTINGS.modelAssignments),
    useSameModelForAgents: z
      .boolean()
      .default(DEFAULT_SETTINGS.useSameModelForAgents),
    logLevel: LogLevelSchema.default(DEFAULT_SETTINGS.logLevel),
    langfuse: LangfuseConfigSchema.default(DEFAULT_SETTINGS.langfuse),
    autoTagEnabled: z.boolean().default(DEFAULT_SETTINGS.autoTagEnabled),
    autoTagCreationEnabled: z
      .boolean()
      .default(DEFAULT_SETTINGS.autoTagCreationEnabled),
    systemPrompt: z.string().default(DEFAULT_SETTINGS.systemPrompt),
    language: z.enum(["system", "en", "zh"]).default(DEFAULT_SETTINGS.language),
    maxParallelAgents: z
      .number()
      .int()
      .min(1)
      .max(10)
      .default(DEFAULT_SETTINGS.maxParallelAgents),
    maxRetries: z
      .number()
      .int()
      .min(0)
      .max(10)
      .default(DEFAULT_SETTINGS.maxRetries),
    searchEngine: SearchEngineSchema.default(DEFAULT_SETTINGS.searchEngine),
    customSearchEngine: CustomSearchEngineSchema.optional(),
    timeouts: TimeoutsConfigSchema.default(DEFAULT_SETTINGS.timeouts),
  })
  .default(DEFAULT_SETTINGS);

export type SettingsState = z.infer<typeof SettingsStateSchema>;

export function getDefaultSettings(): SettingsState {
  return SettingsStateSchema.parse({});
}
