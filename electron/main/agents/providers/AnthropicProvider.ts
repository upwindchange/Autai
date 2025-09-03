import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";
import type { AnthropicProviderConfig } from "@shared/index";
import { BaseProvider } from "@agents/providers/BaseProvider";
import { sendAlert } from "@backend/utils/messageUtils";

/**
 * Provider implementation for Anthropic's Claude models
 */
export class AnthropicProvider extends BaseProvider {
  protected declare readonly config: AnthropicProviderConfig;

  constructor(config: AnthropicProviderConfig) {
    super(config);
  }

  /**
   * Validates the Anthropic provider configuration
   * TypeScript ensures the provider type is correct via discriminated union
   */
  protected validateConfig(): void {
    super.validateConfig();
    // TypeScript ensures this.config is AnthropicProviderConfig
  }

  /**
   * Creates a language model instance for the Anthropic provider
   * @param modelName - The name of the model to use (e.g., "claude-3-opus-20240229")
   * @returns Promise resolving to a LanguageModel instance
   */
  async createLanguageModel(modelName: string): Promise<LanguageModel> {
    if (!this.isConfigured()) {
      sendAlert(
        "Provider Not Configured",
        `Provider "${this.config.name}" is missing Anthropic API key. Please configure it in settings.`
      );
      throw new Error(
        `Provider ${this.config.name} is not properly configured. Anthropic API key is required.`
      );
    }

    // Create the Anthropic provider
    const provider = createAnthropic({
      apiKey: this.config.anthropicApiKey,
    });

    // Return the provider with the specified model
    return provider(modelName);
  }

  /**
   * Checks if the provider is properly configured with required credentials
   * @returns true if Anthropic API key is configured, false otherwise
   */
  isConfigured(): boolean {
    return !!(
      this.config.anthropicApiKey &&
      this.config.anthropicApiKey.trim().length > 0
    );
  }
}
