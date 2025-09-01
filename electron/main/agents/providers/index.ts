import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createAnthropic } from "@ai-sdk/anthropic";
import { settingsService } from "@backend/services";
import type {
  AnthropicProviderConfig,
  OpenAICompatibleProviderConfig,
} from "@shared/index";
import type { LanguageModel } from "ai";

/**
 * Creates a provider based on the active settings for the specified model type
 * @param modelType - The type of model to use ('chat', 'simple' or 'complex')
 * @returns LanguageModel provider function
 */
async function createModel(
  modelType: "chat" | "simple" | "complex" = "simple"
): Promise<LanguageModel> {
  // Get settings
  const settings = settingsService.getSettings();
  if (!settings || !settings.providers || settings.providers.length === 0) {
    throw new Error("No providers configured");
  }

  // If useSameModelForAgents is enabled and requesting simple/complex model,
  // use the chat model configuration instead
  let effectiveModelType = modelType;
  if (settings.useSameModelForAgents) {
    effectiveModelType = "chat";
  }

  // Get the model configuration for the effective model type
  const modelConfig = settings.modelConfigurations?.[effectiveModelType];
  if (!modelConfig) {
    throw new Error(
      `No model configuration found for ${effectiveModelType} model`
    );
  }

  // Find the provider configuration
  const providerConfig = settings.providers.find(
    (p) => p.id === modelConfig.providerId
  );
  if (!providerConfig) {
    throw new Error(`Provider with ID ${modelConfig.providerId} not found`);
  }

  // Return provider based on the selected provider type
  if (providerConfig.provider === "openai-compatible") {
    return createOpenAICompatibleModel(providerConfig, modelConfig.modelName);
  } else if (providerConfig.provider === "anthropic") {
    return createAnthropicModel(providerConfig, modelConfig.modelName);
  } else {
    throw new Error("Unsupported provider: " + providerConfig);
  }
}

/**
 * Creates an OpenAI-compatible provider using the provider configuration
 * @param providerConfig - The provider configuration
 * @param modelName - The name of the model to use
 * @returns OpenAI-compatible provider function
 */
function createOpenAICompatibleModel(
  providerConfig: OpenAICompatibleProviderConfig,
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
async function createAnthropicModel(
  providerConfig: AnthropicProviderConfig,
  modelName: string
): Promise<LanguageModel> {
  if (!providerConfig.anthropicApiKey) {
    throw new Error("Anthropic API key not configured");
  }

  // Create Anthropic provider
  const provider = createAnthropic({
    apiKey: providerConfig.anthropicApiKey,
  });

  // Return provider with the specified model
  return provider(modelName);
}

// Export chat model, simple model and complex model as lazy-loaded functions
export const chatModel = () => createModel("chat");
export const simpleModel = () => createModel("simple");
export const complexModel = () => createModel("complex");
