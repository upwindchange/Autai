import { settingsService } from "@backend/services";
import type { LanguageModel } from "ai";
import type { ProviderConfig } from "@shared/index";
import { BaseProvider } from "@agents/providers/BaseProvider";
import { OpenAICompatibleProvider } from "@agents/providers/OpenAICompatibleProvider";
import { AnthropicProvider } from "@agents/providers/AnthropicProvider";
import { sendAlert } from "@backend/utils/messageUtils";

/**
 * Creates a provider instance based on the configuration type
 * @param config - Provider configuration
 * @returns BaseProvider instance of the appropriate type
 */
export function createProvider(config: ProviderConfig): BaseProvider {
  switch (config.provider) {
    case "openai-compatible":
      return new OpenAICompatibleProvider(config);

    case "anthropic":
      return new AnthropicProvider(config);
  }
}

/**
 * Creates a language model based on the active settings for the specified model type
 * @param modelType - The type of model to use ('chat', 'simple' or 'complex')
 * @returns LanguageModel instance
 */
async function createModel(
  modelType: "chat" | "simple" | "complex" = "simple"
): Promise<LanguageModel> {
  // Get settings
  const settings = settingsService.settings;
  if (!settings || !settings.providers || settings.providers.length === 0) {
    sendAlert(
      "No Providers Configured",
      "Please configure at least one provider in settings before using AI features."
    );
    throw new Error("No providers configured");
  }

  // If useSameModelForAgents is enabled and requesting simple/complex model,
  // use the chat model configuration instead
  let effectiveModelType = modelType;
  if (settings.useSameModelForAgents && modelType !== "chat") {
    effectiveModelType = "chat";
  }

  // Get the model configuration for the effective model type
  const modelConfig = settings.modelConfigurations?.[effectiveModelType];
  if (!modelConfig) {
    sendAlert(
      "Model Not Configured",
      `No configuration found for ${effectiveModelType} model. Please configure it in settings.`
    );
    throw new Error(
      `No model configuration found for ${effectiveModelType} model`
    );
  }

  // Find the provider configuration
  const providerConfig = settings.providers.find(
    (p) => p.id === modelConfig.providerId
  );
  if (!providerConfig) {
    sendAlert(
      "Provider Not Found",
      `Provider "${modelConfig.providerName}" (ID: ${modelConfig.providerId}) not found. Please check your settings.`
    );
    throw new Error(`Provider with ID ${modelConfig.providerId} not found`);
  }

  // Create provider instance
  const provider: BaseProvider = createProvider(providerConfig);

  // Create and return the language model
  return await provider.createLanguageModel(modelConfig.modelName);
}

// Export chat model, simple model and complex model as lazy-loaded functions
export const chatModel = () => createModel("chat");
export const simpleModel = () => createModel("simple");
export const complexModel = () => createModel("complex");
