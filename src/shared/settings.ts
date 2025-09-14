/**
 * Settings-related types shared between main and renderer processes
 */

import { z } from "zod";

// Provider ID schema
export const ProviderIdSchema = z.string().min(1);

// Provider type enum
export const ProviderTypeSchema = z.enum([
  "openai-compatible",
  "anthropic",
  "deepinfra",
]);
export type ProviderType = z.infer<typeof ProviderTypeSchema>;

// OpenAI Compatible Provider Config schema
const OpenAICompatibleProviderConfigSchema = z.object({
  id: ProviderIdSchema.default("default-openai"),
  name: z.string().min(1).default("Default OpenAI"),
  provider: z.literal("openai-compatible").default("openai-compatible"),
  apiKey: z.string().default(""),
  apiUrl: z.string().url().default("https://api.openai.com/v1"),
});

export type OpenAICompatibleProviderConfig = z.infer<
  typeof OpenAICompatibleProviderConfigSchema
>;

// Default OpenAI Compatible Provider Config (with object-level defaults)
const DefaultOpenAICompatibleProviderConfigSchema =
  OpenAICompatibleProviderConfigSchema.default({
    id: "default-openai",
    name: "Default OpenAI",
    provider: "openai-compatible",
    apiKey: "",
    apiUrl: "https://api.openai.com/v1",
  });

// Anthropic Provider Config schema
const AnthropicProviderConfigSchema = z.object({
  id: ProviderIdSchema.default("default-anthropic"),
  name: z.string().min(1).default("Default Anthropic"),
  provider: z.literal("anthropic").default("anthropic"),
  apiKey: z.string().default(""),
  apiUrl: z.string().url().default("https://api.anthropic.com"),
});

export type AnthropicProviderConfig = z.infer<
  typeof AnthropicProviderConfigSchema
>;

// Default Anthropic Provider Config (with object-level defaults)
const DefaultAnthropicProviderConfigSchema =
  AnthropicProviderConfigSchema.default({
    id: "default-anthropic",
    name: "Default Anthropic",
    provider: "anthropic",
    apiKey: "",
    apiUrl: "https://api.anthropic.com",
  });

// DeepInfra Provider Config schema
const DeepInfraProviderConfigSchema = z.object({
  id: ProviderIdSchema.default("default-deepinfra"),
  name: z.string().min(1).default("Default DeepInfra"),
  provider: z.literal("deepinfra").default("deepinfra"),
  apiKey: z.string().default(""),
  apiUrl: z
    .string()
    .url()
    .default("https://api.deepinfra.com/v1/openai"),
});

export type DeepInfraProviderConfig = z.infer<
  typeof DeepInfraProviderConfigSchema
>;

// Default DeepInfra Provider Config (with object-level defaults)
const DefaultDeepInfraProviderConfigSchema =
  DeepInfraProviderConfigSchema.default({
    id: "default-deepinfra",
    name: "Default DeepInfra",
    provider: "deepinfra",
    apiKey: "",
    apiUrl: "https://api.deepinfra.com/v1/openai",
  });

// Union of all provider configurations
export const ProviderConfigSchema = z.discriminatedUnion("provider", [
  OpenAICompatibleProviderConfigSchema,
  AnthropicProviderConfigSchema,
  DeepInfraProviderConfigSchema,
]);

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

// Model configuration schema - base type without defaults
export const ModelConfigSchema = z.object({
  providerId: ProviderIdSchema.default("default-openai"),
  providerName: z.string().min(1).default("Default OpenAI"),
  modelName: z.string().min(1).default("gpt-3.5-turbo"),
  supportsAdvancedUsage: z.boolean().default(true),
});

// Model configuration schema with object-level defaults
export const DefaultModelConfigSchema = ModelConfigSchema.default({
  providerId: "default-openai",
  providerName: "Default OpenAI",
  modelName: "gpt-3.5-turbo",
  supportsAdvancedUsage: true,
});

// Helper function to get default model name by provider type
export function getDefaultModelName(providerType: ProviderType): string {
  switch (providerType) {
    case "openai-compatible":
      return "gpt-3.5-turbo";
    case "anthropic":
      return "claude-3-sonnet-20240229";
    case "deepinfra":
      return "meta-llama/Meta-Llama-3.1-70B-Instruct";
  }
}

// Helper function to get default provider name by provider type
export function getDefaultProviderName(providerType: ProviderType): string {
  switch (providerType) {
    case "openai-compatible":
      return "Default OpenAI";
    case "anthropic":
      return "Default Anthropic";
    case "deepinfra":
      return "Default DeepInfra";
  }
}

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
export const LangfuseConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    publicKey: z.string().optional(),
    secretKey: z.string().optional(),
    host: z.string().optional(), // Optional, defaults to cloud.langfuse.com
  })
  .default({
    enabled: false,
    publicKey: undefined,
    secretKey: undefined,
    host: undefined,
  });

export type LangfuseConfig = z.infer<typeof LangfuseConfigSchema>;

// Default settings values - defined as constants using schema parsing
const DEFAULT_SETTINGS = {
  providers: [
    DefaultOpenAICompatibleProviderConfigSchema.parse({}),
    DefaultAnthropicProviderConfigSchema.parse({}),
    DefaultDeepInfraProviderConfigSchema.parse({}),
  ],
  modelConfigurations: {
    chat: DefaultModelConfigSchema.parse({}),
    simple: DefaultModelConfigSchema.parse({}),
    complex: DefaultModelConfigSchema.parse({}),
  },
  useSameModelForAgents: true,
  logLevel: "info" as const,
  langfuse: LangfuseConfigSchema.parse({}),
};

// Settings State schema - single profile with multiple providers and model configurations
export const SettingsStateSchema = z
  .object({
    providers: z
      .array(ProviderConfigSchema)
      .default(DEFAULT_SETTINGS.providers),
    modelConfigurations: z
      .object({
        chat: DefaultModelConfigSchema,
        simple: DefaultModelConfigSchema,
        complex: DefaultModelConfigSchema,
      })
      .default(DEFAULT_SETTINGS.modelConfigurations),
    useSameModelForAgents: z
      .boolean()
      .default(DEFAULT_SETTINGS.useSameModelForAgents),
    logLevel: LogLevelSchema.default(DEFAULT_SETTINGS.logLevel),
    langfuse: LangfuseConfigSchema.default(DEFAULT_SETTINGS.langfuse),
  })
  .default(DEFAULT_SETTINGS);

// Helper function to get default settings
export function getDefaultSettings(): SettingsState {
  return SettingsStateSchema.parse({});
}

// Helper function to get default provider by type
export function getDefaultProvider(providerType: ProviderType): ProviderConfig {
  switch (providerType) {
    case "openai-compatible":
      return DefaultOpenAICompatibleProviderConfigSchema.parse({});
    case "anthropic":
      return DefaultAnthropicProviderConfigSchema.parse({});
    case "deepinfra":
      return DefaultDeepInfraProviderConfigSchema.parse({});
  }
}

// Helper function to create model config for provider type
export function createModelConfigForProvider(
  providerType: ProviderType
): ModelConfig {
  const defaultProvider = getDefaultProvider(providerType);
  return DefaultModelConfigSchema.parse({
    providerId: defaultProvider.id,
    providerName: defaultProvider.name,
    modelName: getDefaultModelName(providerType),
    supportsAdvancedUsage: true,
  });
}

export type SettingsState = z.infer<typeof SettingsStateSchema>;

// Test Connection Config schema - using the same structure as provider config
export const TestConnectionConfigSchema = z.discriminatedUnion("provider", [
  OpenAICompatibleProviderConfigSchema.extend({
    model: z.string().min(1), // For testing, we might want to specify a different model
  }),
  AnthropicProviderConfigSchema.extend({
    model: z.string().min(1), // For testing, we might want to specify a different model
  }),
  DeepInfraProviderConfigSchema.extend({
    model: z.string().min(1), // For testing, we might want to specify a different model
  }),
]);

export type TestConnectionConfig = z.infer<typeof TestConnectionConfigSchema>;

// Test Connection now returns void - only sends alerts via notification system

// Type alias for ProviderId - inferred from schema
export type ProviderId = z.infer<typeof ProviderIdSchema>;
