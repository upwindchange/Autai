import { app } from "electron";
import * as fs from "fs/promises";
import * as path from "path";
import { OpenAI } from "@langchain/openai";
import type {
  AISettings,
  SettingsProfile,
  SettingsState,
} from "../../shared/types/index";

class SettingsService {
  private settingsPath: string;
  private settings: SettingsState | null = null;

  constructor() {
    const userDataPath = app.getPath("userData");
    this.settingsPath = path.join(userDataPath, "settings.json");
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
      return this.settings;
    } catch (_error) {
      // If file doesn't exist or is invalid, create default settings
      const defaultSettings: SettingsState = {
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
      this.settings = defaultSettings;
      await this.saveSettings(defaultSettings);
      return defaultSettings;
    }
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
        (p) => p.id === this.settings!.activeProfileId
      ) || null
    );
  }

  getActiveSettings(): AISettings | null {
    const profile = this.getActiveProfile();
    return profile ? profile.settings : null;
  }

  async testConnection(config: {
    apiUrl: string;
    apiKey: string;
    model: string;
  }): Promise<{ success: boolean; message: string }> {
    try {
      const testModel = new OpenAI({
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
        message: `Connection failed: ${errorMessage}`,
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
