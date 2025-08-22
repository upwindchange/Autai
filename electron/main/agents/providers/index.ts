import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { settingsService } from "@backend/services";
import type { ProviderConfig, SettingsState, ModelConfig } from "@shared/index";
import type { LanguageModel } from "ai";

/**
 * Creates a provider based on the active settings for the specified model type
 * @param modelType - The type of model to use ('simple' or 'complex')
 * @returns LanguageModel provider function
 */
export async function createAIProvider(
  modelType: "simple" | "complex" = "simple"
): Promise<LanguageModel> {
  // Get settings
  const settings = settingsService.getSettings();
  if (!settings || !settings.providers || settings.providers.length === 0) {
    throw new Error("No providers configured");
  }

  // Get the model configuration for this model type
  const modelConfig = settings.modelConfigurations?.[modelType];
  if (!modelConfig) {
    throw new Error(`No model configuration found for ${modelType} model`);
  }

  // Find the provider configuration
  const providerConfig = settings.providers.find(p => p.id === modelConfig.providerId);
  if (!providerConfig) {
    throw new Error(`Provider with ID ${modelConfig.providerId} not found`);
  }

  // Return provider based on the selected provider type
  if (providerConfig.provider === "openai-compatible") {
    return createOpenAICompatibleProvider(providerConfig as any, modelConfig.modelName);
  } else if (providerConfig.provider === "anthropic") {
    return createAnthropicProvider(providerConfig as any, modelConfig.modelName);
  } else {
    throw new Error("Unsupported provider: " + (providerConfig as any).provider);
  }
}

/**
 * Creates an OpenAI-compatible provider using the provider configuration
 * @param providerConfig - The provider configuration
 * @param modelName - The name of the model to use
 * @returns OpenAI-compatible provider function
 */
function createOpenAICompatibleProvider(
  providerConfig: any,
  modelName: string
): LanguageModel {
  if (!providerConfig.apiKey) {
    throw new Error("API key not configured");
  }

  // Create OpenAI-compatible provider
  const provider = createOpenAICompatible({
    name: providerConfig.name,
    apiKey: providerConfig.apiKey,
    baseURL: providerConfig.apiUrl || "https://api.openai.com/v1",
  });

  // Return provider with the specified model
  return provider(modelName);
}

/**
 * Creates an Anthropic provider using the provider configuration
 * @param providerConfig - The provider configuration
 * @param modelName - The name of the model to use
 * @returns Anthropic provider function
 */
async function createAnthropicProvider(
  providerConfig: any,
  modelName: string
): Promise<LanguageModel> {
  if (!providerConfig.anthropicApiKey) {
    throw new Error("Anthropic API key not configured");
  }

  // Dynamically import Anthropic provider
  const { createAnthropic } = await import('@ai-sdk/anthropic');
  
  // Create Anthropic provider
  const provider = createAnthropic({
    apiKey: providerConfig.anthropicApiKey,
  });

  // Return provider with the specified model
  return provider(modelName);
}

/**
 * Gets all provider configurations
 * @returns Array of ProviderConfig objects
 */
export function getProviderConfigs(): ProviderConfig[] {
  const settings = settingsService.getSettings();
  return settings?.providers || [];
}

/**
 * Gets a specific provider configuration by ID
 * @param providerId - The ID of the provider to retrieve
 * @returns ProviderConfig object or null if not found
 */
export function getProviderConfig(providerId: string): ProviderConfig | null {
  const providers = getProviderConfigs();
  return providers.find(p => p.id === providerId) || null;
}

/**
 * Gets the model configuration for the specified model type
 * @param modelType - The type of model ('simple' or 'complex')
 * @returns ModelConfig object
 */
export function getModelConfig(modelType: "simple" | "complex"): ModelConfig | null {
  const settings = settingsService.getSettings();
  return settings?.modelConfigurations?.[modelType] || null;
}