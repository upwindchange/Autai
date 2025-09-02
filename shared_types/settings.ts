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

// Settings State schema - single profile with multiple providers and model configurations
export const SettingsStateSchema = z.object({
  providers: z.array(ProviderConfigSchema),
  modelConfigurations: z.object({
    chat: ModelConfigSchema,
    simple: ModelConfigSchema,
    complex: ModelConfigSchema,
  }),
  useSameModelForAgents: z.boolean().default(false),
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

// Usage info schema
const UsageSchema = z.object({
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
});

// Test Connection Result schema
export const TestConnectionResultSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  error: z.string().optional(),
  usage: UsageSchema.optional(),
});

export type TestConnectionResult = z.infer<typeof TestConnectionResultSchema>;

// Type alias for ProviderId - inferred from schema
export type ProviderId = z.infer<typeof ProviderIdSchema>;
