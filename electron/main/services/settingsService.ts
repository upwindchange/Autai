import { app } from "electron";
import * as fs from "fs/promises";
import * as path from "path";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";
import type {
  AISettings,
  SettingsProfile,
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
      profiles: [
        {
          id: "default",
          name: "Default",
          settings: {
            provider: "openai-compatible",
            apiUrl: "https://api.openai.com/v1",
            apiKey: "",
            complexModel: "gpt-4",
            simpleModel: "gpt-3.5-turbo",
          },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      activeProfileId: "default",
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

  getActiveProfile(): SettingsProfile | null {
    if (!this.settings) return null;
    return (
      this.settings.profiles.find(
        (p: SettingsProfile) => p.id === this.settings!.activeProfileId
      ) || null
    );
  }

  getActiveSettings(): AISettings | null {
    const profile = this.getActiveProfile();
    return profile ? profile.settings : null;
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
          name: "openai",
          apiKey: (config as any).apiKey,
          baseURL: (config as any).apiUrl,
        });
        model = config.model;
      } else if (config.provider === 'anthropic') {
        // Create Anthropic provider
        const { createAnthropic } = await import('@ai-sdk/anthropic');
        provider = createAnthropic({
          apiKey: (config as any).anthropicApiKey,
        });
        model = config.model;
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
    const settings = this.getActiveSettings();
    if (!settings) return false;
    
    // Check based on provider type
    if (settings.provider === 'openai-compatible') {
      return !!((settings as any).apiKey && (settings as any).apiUrl);
    } else if (settings.provider === 'anthropic') {
      return !!(settings as any).anthropicApiKey;
    }
    
    return false;
  }
}

export const settingsService = new SettingsService();