import { app } from "electron";
import * as fs from "fs/promises";
import * as path from "path";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";
import type {
  ProviderConfig,
  SettingsState,
  TestConnectionConfig,
  TestConnectionResult,
} from "@shared/index";

class SettingsService {
  private settingsPath: string;
  private settings: SettingsState;

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
        simple: {
          providerId: "default-openai",
          modelName: "gpt-3.5-turbo",
        },
        complex: {
          providerId: "default-openai",
          modelName: "gpt-4",
        },
      },
    };
  }

  async initialize() {
    await this.loadSettings();
  }

  async loadSettings(): Promise<SettingsState> {
    try {
      const data = await fs.readFile(this.settingsPath, "utf-8");
      this.settings = JSON.parse(data, (key, value) => {
        // Convert date strings back to Date objects
        if (key === "createdAt" || key === "updatedAt") {
          return new Date(value);
        }
        return value;
      });
    } catch (_error) {
      // If file doesn't exist or is invalid, use existing settings
    }
    return this.settings;
  }

  async saveSettings(settings: SettingsState): Promise<void> {
    this.settings = settings;
    await fs.writeFile(
      this.settingsPath,
      JSON.stringify(settings, null, 2),
      "utf-8"
    );
  }

  getSettings(): SettingsState {
    return this.settings;
  }

  async testConnection(
    config: TestConnectionConfig
  ): Promise<TestConnectionResult> {
    try {
      let provider;
      let model;

      if (config.provider === 'openai-compatible') {
        // Create OpenAI-compatible provider
        provider = createOpenAICompatible({
          name: (config as any).name || "openai",
          apiKey: (config as any).apiKey,
          baseURL: (config as any).apiUrl,
        });
        model = (config as any).model;
      } else if (config.provider === 'anthropic') {
        // Create Anthropic provider
        const { createAnthropic } = await import('@ai-sdk/anthropic');
        provider = createAnthropic({
          apiKey: (config as any).anthropicApiKey,
        });
        model = (config as any).model;
      } else {
        throw new Error("Unsupported provider: " + (config as any).provider);
      }

      // Try a simple completion to test the connection
      const response = await generateText({
        model: provider(model),
        prompt: "Hello, this is a test message.",
        temperature: 0,
        maxOutputTokens: 20,
      });

      if (response && response.text) {
        return {
          success: true,
          message: "Connection successful! API is working correctly.",
          usage: {
            promptTokens: response.usage.inputTokens ?? 0,
            completionTokens: response.usage.outputTokens ?? 0,
            totalTokens: response.usage.totalTokens ?? 0,
          },
        };
      }

      return {
        success: false,
        message: "Connection failed: No response from API",
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        message: `Connection failed`,
        error: errorMessage,
      };
    }
  }

  // Utility method to check if settings are configured
  isConfigured(): boolean {
    if (!this.settings || !this.settings.providers) return false;
    
    // Check if we have model configurations
    if (!this.settings.modelConfigurations) return false;
    
    // Check if the configured providers exist and are properly configured
    const simpleConfig = this.settings.modelConfigurations.simple;
    const complexConfig = this.settings.modelConfigurations.complex;
    
    const simpleProvider = this.settings.providers.find(p => p.id === simpleConfig.providerId);
    const complexProvider = this.settings.providers.find(p => p.id === complexConfig.providerId);
    
    if (!simpleProvider || !complexProvider) return false;
    
    // Check based on provider type for simple provider
    if (simpleProvider.provider === 'openai-compatible') {
      return !!((simpleProvider as any).apiKey && (simpleProvider as any).apiUrl);
    } else if (simpleProvider.provider === 'anthropic') {
      return !!((simpleProvider as any).anthropicApiKey);
    }
    
    return false;
  }
}

export const settingsService = new SettingsService();