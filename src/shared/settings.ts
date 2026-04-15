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
export type { ProviderDefinition, ModelDefinition, ModelRole } from "./providers";

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

// Default model assignments (empty — user configures from catalog)
const DEFAULT_MODEL_ASSIGNMENT = {
  role: "chat" as const,
  providerId: "",
  modelFile: "",
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
  })
  .default(DEFAULT_SETTINGS);

export type SettingsState = z.infer<typeof SettingsStateSchema>;

export function getDefaultSettings(): SettingsState {
  return SettingsStateSchema.parse({});
}
