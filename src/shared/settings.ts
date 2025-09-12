/**
 * Settings-related types shared between main and renderer processes
 */

import { z } from "zod";

// Provider ID schema
export const ProviderIdSchema = z.string().min(1);

// Provider type enum
export const ProviderTypeSchema = z.enum(["openai-compatible", "anthropic"]);
export type ProviderType = z.infer<typeof ProviderTypeSchema>;

// Base Provider Config schema
const BaseProviderConfigSchema = z.object({
  id: ProviderIdSchema,
  name: z.string().min(1), // User-friendly name for the provider
  provider: ProviderTypeSchema,
});

// OpenAI Compatible Provider Config schema
const OpenAICompatibleProviderConfigSchema = BaseProviderConfigSchema.extend({
  provider: z.literal("openai-compatible"),
  apiUrl: z.string().url().default("https://api.openai.com/v1"),
  apiKey: z.string().min(1),
});

export type OpenAICompatibleProviderConfig = z.infer<
  typeof OpenAICompatibleProviderConfigSchema
>;

// Anthropic Provider Config schema
const AnthropicProviderConfigSchema = BaseProviderConfigSchema.extend({
  provider: z.literal("anthropic"),
  anthropicApiKey: z.string().min(1),
});

export type AnthropicProviderConfig = z.infer<
  typeof AnthropicProviderConfigSchema
>;

// Union of all provider configurations
export const ProviderConfigSchema = z.discriminatedUnion("provider", [
  OpenAICompatibleProviderConfigSchema,
  AnthropicProviderConfigSchema,
]);

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

// Model configuration schema
export const ModelConfigSchema = z.object({
  providerId: ProviderIdSchema,
  providerName: z.string().min(1),
  modelName: z.string().min(1),
  supportsAdvancedUsage: z.boolean().default(true),
});

export type ModelConfig = z.infer<typeof ModelConfigSchema>;

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
export const LangfuseConfigSchema = z.object({
  enabled: z.boolean().default(false),
  publicKey: z.string().optional(),
  secretKey: z.string().optional(),
  host: z.string().optional(), // Optional, defaults to cloud.langfuse.com
});

export type LangfuseConfig = z.infer<typeof LangfuseConfigSchema>;

// Settings State schema - single profile with multiple providers and model configurations
export const SettingsStateSchema = z.object({
  providers: z.array(ProviderConfigSchema),
  modelConfigurations: z.object({
    chat: ModelConfigSchema,
    simple: ModelConfigSchema,
    complex: ModelConfigSchema,
  }),
  useSameModelForAgents: z.boolean().default(false),
  logLevel: LogLevelSchema.default("info"),
  langfuse: LangfuseConfigSchema,
});

export type SettingsState = z.infer<typeof SettingsStateSchema>;

// Test Connection Config schema - using the same structure as provider config
export const TestConnectionConfigSchema = z.discriminatedUnion("provider", [
  OpenAICompatibleProviderConfigSchema.extend({
    model: z.string().min(1), // For testing, we might want to specify a different model
  }),
  AnthropicProviderConfigSchema.extend({
    model: z.string().min(1), // For testing, we might want to specify a different model
  }),
]);

export type TestConnectionConfig = z.infer<typeof TestConnectionConfigSchema>;

// Test Connection now returns void - only sends alerts via notification system

// Type alias for ProviderId - inferred from schema
export type ProviderId = z.infer<typeof ProviderIdSchema>;
