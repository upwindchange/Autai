import { app } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { generateText } from "ai";
import { createProvider } from "@agents/providers";
import { sendSuccess, sendAlert, sendInfo } from "@/utils/messageUtils";
import log from "electron-log/main";
import type {
  SettingsState,
  TestConnectionConfig,
  ProviderConfig,
} from "@shared";
import { SettingsStateSchema } from "@shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface ProviderRow {
  id: string;
  name: string;
  provider_type: string;
  api_key: string;
  api_url: string;
}

interface ModelConfigRow {
  model_type: string;
  provider_id: string;
  model_name: string;
  supports_advanced_usage: number;
}

class SettingsService {
  private _settings: SettingsState;
  private db: Database.Database | null = null;
  private logger = log.scope("SettingsService");

  constructor() {
    this._settings = SettingsStateSchema.parse({});
  }

  public get settings(): SettingsState {
    if (this._settings.useSameModelForAgents) {
      return {
        ...this._settings,
        modelConfigurations: {
          ...this._settings.modelConfigurations,
          simple: this._settings.modelConfigurations.chat,
          complex: this._settings.modelConfigurations.chat,
        },
      };
    }
    return this._settings;
  }

  private set settings(value: SettingsState) {
    this._settings = value;
  }

  initialize(): void {
    const userDataPath = app.getPath("userData");
    const dbPath = path.join(userDataPath, "autai.db");

    this.db = new Database(dbPath, {
      nativeBinding: path.join(__dirname, "better_sqlite3.node"),
    });

    this.db.pragma("journal_mode = WAL");
    this.createTables();
    this.loadSettings();
  }

  private createTables(): void {
    if (!this.db) throw new Error("Database not initialized");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS providers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        provider_type TEXT NOT NULL,
        api_key TEXT NOT NULL DEFAULT '',
        api_url TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS model_configurations (
        model_type TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        model_name TEXT NOT NULL,
        supports_advanced_usage INTEGER NOT NULL DEFAULT 1
      );
    `);
  }

  private loadSettings(): void {
    if (!this.db) throw new Error("Database not initialized");

    const defaults = SettingsStateSchema.parse({});

    // Load key-value settings
    const settingsRows = this.db
      .prepare("SELECT key, value FROM settings")
      .all() as { key: string; value: string }[];
    const settingsMap = new Map(settingsRows.map((r) => [r.key, r.value]));

    // If no settings exist yet, keep defaults
    if (settingsMap.size === 0) return;

    // Load providers
    const providerRows = this.db
      .prepare("SELECT * FROM providers ORDER BY rowid")
      .all() as ProviderRow[];

    // Load model configurations
    const modelConfigRows = this.db
      .prepare("SELECT * FROM model_configurations")
      .all() as ModelConfigRow[];

    // Build providers from DB rows, fallback to defaults
    const providers: ProviderConfig[] =
      providerRows.length > 0 ?
        providerRows.map((row) => this.buildProvider(row))
      : defaults.providers;

    // Build model configurations from DB rows, fallback to defaults
    const modelConfigurations =
      modelConfigRows.length > 0 ?
        {
          chat: this.buildModelConfig(modelConfigRows, "chat", providers),
          simple: this.buildModelConfig(modelConfigRows, "simple", providers),
          complex: this.buildModelConfig(modelConfigRows, "complex", providers),
        }
      : defaults.modelConfigurations;

    this._settings = SettingsStateSchema.parse({
      providers,
      modelConfigurations,
      useSameModelForAgents:
        settingsMap.get("use_same_model_for_agents") === "true",
      logLevel: settingsMap.get("log_level") || defaults.logLevel,
      langfuse: {
        enabled: settingsMap.get("langfuse_enabled") === "true",
        publicKey: settingsMap.get("langfuse_public_key") || undefined,
        secretKey: settingsMap.get("langfuse_secret_key") || undefined,
        host: settingsMap.get("langfuse_host") || undefined,
      },
      autoTagEnabled:
        settingsMap.get("auto_tag_enabled") !== "false",
      autoTagCreationEnabled:
        settingsMap.get("auto_tag_creation_enabled") !== "false",
    });
  }

  private buildProvider(row: ProviderRow): ProviderConfig {
    const base = {
      id: row.id,
      name: row.name,
      apiKey: row.api_key,
      apiUrl: row.api_url,
    };

    switch (row.provider_type) {
      case "anthropic":
        return { ...base, provider: "anthropic" as const };
      case "deepinfra":
        return { ...base, provider: "deepinfra" as const };
      default:
        return { ...base, provider: "openai-compatible" as const };
    }
  }

  private buildModelConfig(
    rows: ModelConfigRow[],
    type: string,
    providers: ProviderConfig[],
  ): SettingsState["modelConfigurations"]["chat"] {
    const row = rows.find((r) => r.model_type === type);
    if (!row) return SettingsStateSchema.parse({}).modelConfigurations[type];

    const provider = providers.find((p) => p.id === row.provider_id);
    return {
      providerId: row.provider_id,
      providerName: provider?.name || "",
      modelName: row.model_name,
      supportsAdvancedUsage: row.supports_advanced_usage === 1,
    };
  }

  saveSettings(settings: SettingsState): void {
    if (!this.db) throw new Error("Database not initialized");

    const updatedSettings = this.syncProviderNames(settings);
    this._settings = updatedSettings;

    const upsertSetting = this.db.prepare(
      "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
    );
    const deleteProviders = this.db.prepare("DELETE FROM providers");
    const insertProvider = this.db.prepare(
      "INSERT INTO providers (id, name, provider_type, api_key, api_url) VALUES (?, ?, ?, ?, ?)",
    );
    const deleteModelConfigs = this.db.prepare(
      "DELETE FROM model_configurations",
    );
    const insertModelConfig = this.db.prepare(
      "INSERT INTO model_configurations (model_type, provider_id, model_name, supports_advanced_usage) VALUES (?, ?, ?, ?)",
    );

    const saveAll = this.db.transaction(() => {
      // Upsert key-value settings
      upsertSetting.run(
        "use_same_model_for_agents",
        String(updatedSettings.useSameModelForAgents),
      );
      upsertSetting.run("log_level", updatedSettings.logLevel);
      upsertSetting.run(
        "langfuse_enabled",
        String(updatedSettings.langfuse.enabled),
      );
      upsertSetting.run(
        "langfuse_public_key",
        updatedSettings.langfuse.publicKey || "",
      );
      upsertSetting.run(
        "langfuse_secret_key",
        updatedSettings.langfuse.secretKey || "",
      );
      upsertSetting.run("langfuse_host", updatedSettings.langfuse.host || "");

      // Thread intelligence settings
      upsertSetting.run(
        "auto_tag_enabled",
        String(updatedSettings.autoTagEnabled),
      );
      upsertSetting.run(
        "auto_tag_creation_enabled",
        String(updatedSettings.autoTagCreationEnabled),
      );

      // Replace all providers
      deleteProviders.run();
      for (const provider of updatedSettings.providers) {
        insertProvider.run(
          provider.id,
          provider.name,
          provider.provider,
          provider.apiKey,
          provider.apiUrl,
        );
      }

      // Replace all model configurations
      deleteModelConfigs.run();
      for (const [type, config] of Object.entries(
        updatedSettings.modelConfigurations,
      )) {
        insertModelConfig.run(
          type,
          config.providerId,
          config.modelName,
          config.supportsAdvancedUsage ? 1 : 0,
        );
      }
    });

    saveAll();
  }

  async testConnection(config: TestConnectionConfig): Promise<void> {
    try {
      this.logger.info("testing connection", {
        config,
      });

      sendInfo("Testing Connection", `Testing ${config.model} connection...`);

      const baseConfig = {
        id: config.id || "test-provider",
        name: config.name || "Test Provider",
        provider: config.provider,
        apiKey: config.apiKey,
        ...(config.apiUrl && { apiUrl: config.apiUrl }),
      };

      const provider = createProvider(baseConfig as ProviderConfig);
      const languageModel = provider.createLanguageModel(config.model);

      this.logger.debug("testing basic connection with Hi prompt");
      const response = await generateText({
        model: languageModel,
        prompt: "reply only one word",
        temperature: 0,
      });

      if (response && response.text) {
        this.logger.info("basic connection test successful", {
          responseLength: response.text.length,
          usage: response.usage,
        });

        sendSuccess(
          "Connection Successful",
          `${config.model} connected successfully! API is working correctly.`,
        );
      } else {
        this.logger.error("basic connection test failed - no response");
        sendAlert(
          "Connection Failed",
          `${config.model} connection failed: No response from API`,
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error("connection test failed", { error: errorMessage });
      sendAlert(
        "Connection Failed",
        `${config.model} connection failed: ${errorMessage}`,
      );
    }
  }

  isConfigured(): boolean {
    if (!this._settings || !this._settings.providers) return false;

    if (!this._settings.modelConfigurations) return false;

    const chatConfig = this._settings.modelConfigurations.chat;
    const chatProvider = this._settings.providers.find(
      (p) => p.id === chatConfig.providerId,
    );

    if (!chatProvider) return false;

    const providerInstance = createProvider(chatProvider);
    const chatConfigured = providerInstance.isConfigured();

    if (!chatConfigured) return false;

    if (this._settings.useSameModelForAgents) {
      return true;
    }

    const simpleConfig = this._settings.modelConfigurations.simple;
    const complexConfig = this._settings.modelConfigurations.complex;

    if (
      simpleConfig.providerId === chatConfig.providerId &&
      complexConfig.providerId === chatConfig.providerId
    ) {
      return true;
    }

    const simpleProvider = this._settings.providers.find(
      (p) => p.id === simpleConfig.providerId,
    );
    const complexProvider = this._settings.providers.find(
      (p) => p.id === complexConfig.providerId,
    );

    if (!simpleProvider || !complexProvider) return false;

    const simpleProviderInstance = createProvider(simpleProvider);
    const simpleConfigured = simpleProviderInstance.isConfigured();

    if (complexConfig.providerId !== simpleConfig.providerId) {
      const complexProviderInstance = createProvider(complexProvider);
      const complexConfigured = complexProviderInstance.isConfigured();
      return simpleConfigured && complexConfigured;
    }

    return simpleConfigured;
  }

  updateModelAdvancedCapability(
    modelType: keyof SettingsState["modelConfigurations"],
    supportsAdvancedUsage: boolean,
  ): void {
    if (!this._settings.modelConfigurations) return;

    this._settings.modelConfigurations[modelType].supportsAdvancedUsage =
      supportsAdvancedUsage;
    this.saveSettings(this._settings);
  }

  private syncProviderNames(settings: SettingsState): SettingsState {
    if (!settings.modelConfigurations || !settings.providers) return settings;

    const updatedModelConfigurations = { ...settings.modelConfigurations };

    (
      Object.keys(updatedModelConfigurations) as Array<
        keyof typeof updatedModelConfigurations
      >
    ).forEach((modelType) => {
      const modelConfig = updatedModelConfigurations[modelType];
      const provider = settings.providers.find(
        (p) => p.id === modelConfig.providerId,
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

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.logger.info("Settings database connection closed");
    }
  }
}

export const settingsService = new SettingsService();
