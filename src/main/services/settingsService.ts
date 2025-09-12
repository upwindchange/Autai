import { app } from "electron";
import * as fs from "fs/promises";
import * as path from "path";
import { generateText, generateObject, LanguageModel } from "ai";
import { createProvider } from "@agents/providers";
import { sendSuccess, sendAlert, sendInfo } from "@/utils/messageUtils";
import { z } from "zod";
import log from "electron-log/main";
import type {
  SettingsState,
  TestConnectionConfig,
  ProviderConfig,
} from "@shared";

class SettingsService {
  public settings: SettingsState;
  private settingsPath: string;
  private logger = log.scope("SettingsService");

  constructor() {
    const userDataPath = app.getPath("userData");
    this.settingsPath = path.join(userDataPath, "settings.json");
    // Initialize with default settings
    this.settings = {
      providers: [
        {
          id: "default-openai",
          name: "Default OpenAI",
          provider: "openai-compatible",
          apiUrl: "https://api.openai.com/v1",
          apiKey: "",
        },
      ],
      modelConfigurations: {
        chat: {
          providerId: "default-openai",
          providerName: "Default OpenAI",
          modelName: "gpt-3.5-turbo",
          supportsAdvancedUsage: true,
        },
        simple: {
          providerId: "default-openai",
          providerName: "Default OpenAI",
          modelName: "gpt-3.5-turbo",
          supportsAdvancedUsage: true,
        },
        complex: {
          providerId: "default-openai",
          providerName: "Default OpenAI",
          modelName: "gpt-4",
          supportsAdvancedUsage: true,
        },
      },
      useSameModelForAgents: true,
      logLevel: "info",
      langfuse: {
        enabled: false,
        publicKey: undefined,
        secretKey: undefined,
        host: undefined,
      },
    };
  }

  async initialize() {
    await this.loadSettings();
  }

  async loadSettings(): Promise<SettingsState> {
    try {
      const data = await fs.readFile(this.settingsPath, "utf-8");
      this.settings = JSON.parse(data, (_key, value) => {
        // Example post processing
        // if (_key === "createdAt" || _key === "updatedAt") {
        //   return new Date(value);
        // }
        return value;
      });
    } catch (_error) {
      // If file doesn't exist or is invalid, use existing settings
    }
    return this.settings;
  }

  async saveSettings(settings: SettingsState): Promise<void> {
    // Sync provider names in model configurations before saving
    const updatedSettings = this.syncProviderNames(settings);
    this.settings = updatedSettings;
    await fs.writeFile(
      this.settingsPath,
      JSON.stringify(updatedSettings, null, 2),
      "utf-8"
    );
  }

  // Sync provider names in model configurations to ensure they match current providers
  private syncProviderNames(settings: SettingsState): SettingsState {
    if (!settings.modelConfigurations || !settings.providers) return settings;

    const updatedModelConfigurations = { ...settings.modelConfigurations };

    // Update provider names for all model types
    (
      Object.keys(updatedModelConfigurations) as Array<
        keyof typeof updatedModelConfigurations
      >
    ).forEach((modelType) => {
      const modelConfig = updatedModelConfigurations[modelType];
      const provider = settings.providers.find(
        (p) => p.id === modelConfig.providerId
      );
      if (provider) {
        updatedModelConfigurations[modelType] = {
          ...modelConfig,
          providerName: provider.name,
        };
      }
    });

    return {
      ...settings,
      modelConfigurations: updatedModelConfigurations,
    };
  }

  async testConnection(config: TestConnectionConfig): Promise<void> {
    try {
      this.logger.info("testing connection", {
        model: config.model,
        provider: config.provider,
        providerName: config.name,
      });

      // Send initial test message
      sendInfo("Testing Connection", `Testing ${config.model} connection...`);

      // Extract base provider config from test config
      const baseConfig = {
        id: config.id || "test-provider",
        name: config.name || "Test Provider",
        provider: config.provider,
        ...(config.provider === "openai-compatible"
          ? {
              apiKey: config.apiKey,
              apiUrl: config.apiUrl,
            }
          : {}),
        ...(config.provider === "anthropic"
          ? {
              anthropicApiKey: config.anthropicApiKey,
            }
          : {}),
      };

      // Create provider instance
      const provider = createProvider(baseConfig as ProviderConfig);
      const languageModel = await provider.createLanguageModel(config.model);

      // Try a simple completion to test the connection
      this.logger.debug("testing basic connection with Hi prompt");
      const response = await generateText({
        model: languageModel,
        prompt: "Hi",
        temperature: 0,
        maxOutputTokens: 20,
      });

      if (response && response.text) {
        this.logger.info("basic connection test successful", {
          responseLength: response.text.length,
          usage: response.usage,
        });

        // Connection successful - show immediate success message
        sendSuccess(
          "Connection Successful",
          `${config.model} connected successfully! API is working correctly.`
        );

        // Now test advanced capabilities
        this.logger.debug("testing advanced capabilities with enum generation");
        await this.validateModelCapabilities(languageModel, config);
      } else {
        this.logger.error("basic connection test failed - no response");
        sendAlert(
          "Connection Failed",
          `${config.model} connection failed: No response from API`
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error("connection test failed", { error: errorMessage });
      sendAlert(
        "Connection Failed",
        `${config.model} connection failed: ${errorMessage}`
      );
    }
  }

  private async validateModelCapabilities(
    languageModel: LanguageModel,
    config: TestConnectionConfig
  ): Promise<void> {
    try {
      const { object } = await generateObject({
        model: languageModel,
        output: "enum",
        enum: ["JHERfcgPFc", "TjWwVanGcn"],
        experimental_telemetry: {
          isEnabled: this.settings.langfuse.enabled,
          functionId: "test-connection-validate-capabilities",
        },
        prompt: "Generate one of the provided enum values",
      });
      
      this.logger.debug("enum generation result", { object });

      // Validate the returned value is one of our expected strings using Zod
      const validValues = z.enum(["JHERfcgPFc", "TjWwVanGcn"]);
      const result = validValues.safeParse(object);

      if (!result.success) {
        this.logger.error("enum validation failed", { 
          object, 
          validationError: result.error 
        });
        
        // Enum validation failed - show capability alert
        const providerName = config.name || config.id;
        const modelName = config.model;

        sendAlert(
          "Model capability alert",
          `AI model "${modelName}" from provider "${providerName}" is unable to process advanced requests. Browser automation and AI agent features will be disabled. Tool usage may fail. Please configure a model that supports advanced capabilities for optimal experience.`
        );
      } else {
        this.logger.info("enum validation successful", { object });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      this.logger.error("enum generation failed", { error: errorMessage });
      
      // Exception during enum generation - show capability alert
      const providerName = config.name || config.id;
      const modelName = config.model;

      sendAlert(
        "Model capability alert",
        `AI model "${modelName}" from provider "${providerName}" is unable to process advanced requests. Browser automation and AI agent features will be disabled. Tool usage may fail. Please configure a model that supports advanced capabilities for optimal experience.`
      );
    }
  }

  // Utility method to check if settings are configured
  isConfigured(): boolean {
    if (!this.settings || !this.settings.providers) return false;

    // Check if we have model configurations
    if (!this.settings.modelConfigurations) return false;

    // Check if the chat model is configured
    const chatConfig = this.settings.modelConfigurations.chat;
    const chatProvider = this.settings.providers.find(
      (p) => p.id === chatConfig.providerId
    );

    if (!chatProvider) return false;

    // Check chat provider configuration
    const providerInstance = createProvider(chatProvider);
    const chatConfigured = providerInstance.isConfigured();

    if (!chatConfigured) return false;

    // If useSameModelForAgents is enabled, only chat model needs to be configured
    if (this.settings.useSameModelForAgents) {
      return true;
    }

    // Otherwise, check both simple and complex models
    const simpleConfig = this.settings.modelConfigurations.simple;
    const complexConfig = this.settings.modelConfigurations.complex;

    // Check if both models use the same provider as chat (common case)
    if (
      simpleConfig.providerId === chatConfig.providerId &&
      complexConfig.providerId === chatConfig.providerId
    ) {
      return true; // Same provider, already validated above
    }

    const simpleProvider = this.settings.providers.find(
      (p) => p.id === simpleConfig.providerId
    );
    const complexProvider = this.settings.providers.find(
      (p) => p.id === complexConfig.providerId
    );

    if (!simpleProvider || !complexProvider) return false;

    // Check simple provider configuration
    const simpleProviderInstance = createProvider(simpleProvider);
    const simpleConfigured = simpleProviderInstance.isConfigured();

    // Check complex provider configuration (if different from simple)
    if (complexConfig.providerId !== simpleConfig.providerId) {
      const complexProviderInstance = createProvider(complexProvider);
      const complexConfigured = complexProviderInstance.isConfigured();
      return simpleConfigured && complexConfigured;
    }

    return simpleConfigured;
  }

  // Update model advanced capability setting
  async updateModelAdvancedCapability(
    modelType: keyof SettingsState["modelConfigurations"],
    supportsAdvancedUsage: boolean
  ): Promise<void> {
    if (!this.settings.modelConfigurations) return;

    this.settings.modelConfigurations[modelType].supportsAdvancedUsage =
      supportsAdvancedUsage;
    await this.saveSettings(this.settings);
  }
}

export const settingsService = new SettingsService();
