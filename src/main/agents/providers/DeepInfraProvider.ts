import { createDeepInfra, DeepInfraProviderSettings } from "@ai-sdk/deepinfra";
import type { LanguageModel } from "ai";
import type { DeepInfraProviderConfig } from "@shared";
import { BaseProvider } from "@agents/providers/BaseProvider";
import { sendAlert } from "@/utils/messageUtils";

/**
 * Provider implementation for DeepInfra API
 * Supports state-of-the-art models through DeepInfra including Llama 3, Mixtral, Qwen, etc.
 */
export class DeepInfraProvider extends BaseProvider {
  protected declare readonly config: DeepInfraProviderConfig;

  constructor(config: DeepInfraProviderConfig) {
    super(config);
  }

  /**
   * Validates the DeepInfra provider configuration
   * TypeScript ensures the provider type is correct via discriminated union
   */
  protected validateConfig(): void {
    super.validateConfig();
    // TypeScript ensures this.config is DeepInfraProviderConfig
  }

  /**
   * Creates a language model instance for the DeepInfra provider
   * @param modelName - The name of the model to use (e.g., "meta-llama/Meta-Llama-3.1-70B-Instruct")
   * @returns Promise resolving to a LanguageModel instance
   */
  async createLanguageModel(modelName: string): Promise<LanguageModel> {
    if (!this.isConfigured()) {
      sendAlert(
        "Provider Not Configured",
        `Provider "${this.config.name}" is missing API key. Please configure it in settings.`
      );
      throw new Error(
        `Provider ${this.config.name} is not properly configured. API key is required.`
      );
    }

    // Create the DeepInfra provider
    const providerOptions: DeepInfraProviderSettings = {
      apiKey: this.config.apiKey,
    };

    if (this.config.apiUrl) {
      providerOptions.baseURL = this.config.apiUrl;
    }

    const provider = createDeepInfra(providerOptions);

    // Return the provider with the specified model
    return provider(modelName);
  }

  /**
   * Checks if the provider is properly configured with required credentials
   * @returns true if API key is configured, false otherwise
   */
  isConfigured(): boolean {
    return !!(this.config.apiKey && this.config.apiKey.trim().length > 0);
  }
}
