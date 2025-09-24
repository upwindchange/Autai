import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { ChatOpenAI } from "@langchain/openai";
import type { LanguageModel } from "ai";
import type { OpenAICompatibleProviderConfig } from "@shared";
import { BaseProvider } from "@agents/providers/BaseProvider";
import { sendAlert } from "@/utils/messageUtils";

/**
 * Provider implementation for OpenAI-compatible APIs
 * Supports OpenAI API and compatible services like Groq, Together AI, etc.
 */
export class OpenAICompatibleProvider extends BaseProvider {
  protected declare readonly config: OpenAICompatibleProviderConfig;

  constructor(config: OpenAICompatibleProviderConfig) {
    super(config);
  }

  /**
   * Validates the OpenAI-compatible provider configuration
   * TypeScript ensures the provider type is correct via discriminated union
   */
  protected validateConfig(): void {
    super.validateConfig();
    // TypeScript ensures this.config is OpenAICompatibleProviderConfig
  }

  /**
   * Creates a language model instance for the OpenAI-compatible provider
   * @param modelName - The name of the model to use (e.g., "gpt-4", "gpt-3.5-turbo")
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

    // Create the OpenAI-compatible provider
    const provider = createOpenAICompatible({
      name: this.config.name,
      apiKey: this.config.apiKey,
      baseURL: this.config.apiUrl || "https://api.openai.com/v1",
    });

    // Return the provider with the specified model
    return provider(modelName);
  }

  /**
   * Creates a LangChain ChatOpenAI model instance for the OpenAI-compatible provider
   * @param modelName - The name of the model to use (e.g., "gpt-4", "gpt-3.5-turbo")
   * @returns BaseChatModel instance configured with the provider settings
   */
  createLangchainModel(modelName: string): ChatOpenAI {
    if (!this.isConfigured()) {
      sendAlert(
        "Provider Not Configured",
        `Provider "${this.config.name}" is missing API key. Please configure it in settings.`
      );
      throw new Error(
        `Provider ${this.config.name} is not properly configured. API key is required.`
      );
    }

    // Create the LangChain ChatOpenAI model
    return new ChatOpenAI({
      configuration: {
        baseURL: this.config.apiUrl || "https://api.openai.com/v1",
        apiKey: this.config.apiKey,
      },
      model: modelName,
      temperature: 0,
    });
  }

  /**
   * Checks if the provider is properly configured with required credentials
   * @returns true if API key is configured, false otherwise
   */
  isConfigured(): boolean {
    return !!(this.config.apiKey && this.config.apiKey.trim().length > 0);
  }
}
