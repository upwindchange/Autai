import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { settingsService } from "@backend/services";
import type { AISettings } from "@shared/index";
import type { LanguageModel } from "ai";

/**
 * Creates a provider based on the active settings
 * @param modelType - The type of model to use ('simple' or 'complex')
 * @returns LanguageModel provider function
 */
export async function createAIProvider(
  modelType: "simple" | "complex" = "simple"
): Promise<LanguageModel> {
  // Get settings
  const settings = settingsService.getActiveSettings();
  if (!settings) {
    throw new Error("No settings configured");
  }

  // Return provider based on the selected provider type
  if (settings.provider === "openai-compatible") {
    return createOpenAICompatibleProvider(settings as any, modelType);
  } else if (settings.provider === "anthropic") {
    return createAnthropicProvider(settings as any, modelType);
  } else {
    throw new Error("Unsupported provider: " + (settings as any).provider);
  }
}

/**
 * Creates an OpenAI-compatible provider using the active settings
 * @param settings - The AI settings
 * @param modelType - The type of model to use ('simple' or 'complex')
 * @returns OpenAI-compatible provider function
 */
function createOpenAICompatibleProvider(
  settings: any,
  modelType: "simple" | "complex" = "simple"
): LanguageModel {
  if (!settings.apiKey) {
    throw new Error("API key not configured");
  }

  // Create OpenAI-compatible provider
  const provider = createOpenAICompatible({
    name: "openai",
    apiKey: settings.apiKey,
    baseURL: settings.apiUrl || "https://api.openai.com/v1",
  });

  // Return provider with the appropriate model
  const model =
    modelType === "complex"
      ? settings.complexModel || "gpt-4"
      : settings.simpleModel || "gpt-4o-mini";

  return provider(model);
}

/**
 * Creates an Anthropic provider using the active settings
 * @param settings - The AI settings
 * @param modelType - The type of model to use ('simple' or 'complex')
 * @returns Anthropic provider function
 */
async function createAnthropicProvider(
  settings: any,
  modelType: "simple" | "complex" = "simple"
): Promise<LanguageModel> {
  if (!settings.anthropicApiKey) {
    throw new Error("Anthropic API key not configured");
  }

  // Dynamically import Anthropic provider
  const { createAnthropic } = await import('@ai-sdk/anthropic');
  
  // Create Anthropic provider
  const provider = createAnthropic({
    apiKey: settings.anthropicApiKey,
  });

  // Return provider with the appropriate model
  // Note: Anthropic models are prefixed with "claude-"
  const model =
    modelType === "complex"
      ? settings.complexModel || "claude-3-sonnet-20240229"
      : settings.simpleModel || "claude-3-haiku-20240307";

  return provider(model);
}

/**
 * Gets the active AI settings
 * @returns AISettings object or null if not configured
 */
export function getAISettings(): AISettings | null {
  return settingsService.getActiveSettings();
}