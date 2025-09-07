import type { LanguageModel } from "ai";
import type { ProviderConfig } from "@shared";

/**
 * Abstract base class for all AI model providers
 * Provides common functionality and interface for provider implementations
 */
export abstract class BaseProvider {
  protected readonly config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
    this.validateConfig();
  }

  /**
   * Creates a language model instance with the specified model name
   * @param modelName - The name of the model to create
   * @returns Promise resolving to a LanguageModel instance
   */
  abstract createLanguageModel(modelName: string): Promise<LanguageModel>;

  /**
   * Validates the provider configuration
   * Can be overridden by subclasses for specific validation logic
   * @throws Error if configuration is invalid
   */
  protected validateConfig(): void {
    // Basic validation - TypeScript ensures these fields exist
    // Subclasses can override for specific validation
  }

  /**
   * Returns the provider ID
   */
  get id(): string {
    return this.config.id;
  }

  /**
   * Returns the provider name
   */
  get name(): string {
    return this.config.name;
  }

  /**
   * Returns the provider type
   */
  get type(): string {
    return this.config.provider;
  }

  /**
   * Checks if the provider is properly configured
   * Can be overridden by subclasses for specific configuration checks
   */
  abstract isConfigured(): boolean;
}