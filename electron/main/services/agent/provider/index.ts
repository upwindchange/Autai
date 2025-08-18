import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { settingsService } from "@/services";
import type { AISettings } from "@shared/index";
import type { LanguageModel } from "ai";

/**
 * Creates an OpenAI-compatible provider using the active settings
 * @param modelType - The type of model to use ('simple' or 'complex')
 * @returns OpenAI-compatible provider function
 */
export function createAIProvider(
  modelType: "simple" | "complex" = "simple"
): LanguageModel {
  // Get settings
  const settings = settingsService.getActiveSettings();
  if (!settings?.apiKey) {
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
 * Gets the active AI settings
 * @returns AISettings object or null if not configured
 */
export function getAISettings(): AISettings | null {
  return settingsService.getActiveSettings();
}
