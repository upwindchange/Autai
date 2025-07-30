import { app } from "electron";
import * as fs from "fs/promises";
import * as path from "path";
import { ChatOpenAI } from "@langchain/openai";
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
      const testModel = new ChatOpenAI({
        temperature: 0,
        apiKey: config.apiKey,
        modelName: config.model,
        configuration: {
          baseURL: config.apiUrl,
        },
      });

      // Try a simple completion to test the connection
      const response = await testModel.invoke("Hello, this is a test message.");

      if (response && response.content) {
        return {
          success: true,
          message: "Connection successful! API is working correctly.",
          usage: response.response_metadata.tokenUsage,
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
    return !!(settings && settings.apiKey && settings.apiUrl);
  }
}

export const settingsService = new SettingsService();
