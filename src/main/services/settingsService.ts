/**
 * Settings Service — manages provider configurations and model assignments in SQLite.
 * Driven by the TOML provider registry (no hardcoded provider types).
 */

import { app } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { generateText } from "ai";
import { Provider } from "@agents/providers/provider";
import * as registry from "@agents/providers/registry";
import { invalidateModelCache } from "@agents/providers";
import { sendSuccess, sendAlert, sendInfo } from "@/utils/messageUtils";
import log from "electron-log/main";
import type {
  SettingsState,
  TestConnectionConfig,
  UserProviderConfig,
  ModelRoleAssignment,
} from "@shared";
import { SettingsStateSchema } from "@shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface UserProviderRow {
  id: string;
  provider_dir: string;
  api_key: string;
  api_url_override: string | null;
}

interface ModelAssignmentRow {
  role: string;
  provider_id: string;
  model_file: string;
  params: string | null;
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
        modelAssignments: {
          ...this._settings.modelAssignments,
          simple: { ...this._settings.modelAssignments.chat, role: "simple" },
          complex: { ...this._settings.modelAssignments.chat, role: "complex" },
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
    this.migrateSchema();
    this.loadSettings();
  }

  private migrateSchema(): void {
    if (!this.db) throw new Error("Database not initialized");

    // Drop old tables if they exist (aggressive migration, no backward compat)
    this.db.exec(`
      DROP TABLE IF EXISTS model_configurations;
      DROP TABLE IF EXISTS providers;
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS user_providers (
        id TEXT PRIMARY KEY,
        provider_dir TEXT NOT NULL,
        api_key TEXT NOT NULL DEFAULT '',
        api_url_override TEXT
      );

      CREATE TABLE IF NOT EXISTS model_assignments (
        role TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL REFERENCES user_providers(id) ON DELETE CASCADE,
        model_file TEXT NOT NULL,
        params TEXT
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

    // Load user providers
    const providerRows = this.db
      .prepare("SELECT * FROM user_providers ORDER BY rowid")
      .all() as UserProviderRow[];

    const providers: UserProviderConfig[] = providerRows.map((row) => ({
      id: row.id,
      providerDir: row.provider_dir,
      apiKey: row.api_key,
      ...(row.api_url_override && { apiUrlOverride: row.api_url_override }),
    }));

    // Load model assignments
    const assignmentRows = this.db
      .prepare("SELECT * FROM model_assignments")
      .all() as ModelAssignmentRow[];

    const modelAssignments = {
      chat: this.buildAssignment(assignmentRows, "chat", defaults),
      simple: this.buildAssignment(assignmentRows, "simple", defaults),
      complex: this.buildAssignment(assignmentRows, "complex", defaults),
    };

    this._settings = SettingsStateSchema.parse({
      providers: providers.length > 0 ? providers : defaults.providers,
      modelAssignments,
      useSameModelForAgents:
        settingsMap.get("use_same_model_for_agents") !== "false",
      logLevel: settingsMap.get("log_level") || defaults.logLevel,
      langfuse: {
        enabled: settingsMap.get("langfuse_enabled") === "true",
        publicKey: settingsMap.get("langfuse_public_key") || undefined,
        secretKey: settingsMap.get("langfuse_secret_key") || undefined,
        host: settingsMap.get("langfuse_host") || undefined,
      },
      autoTagEnabled: settingsMap.get("auto_tag_enabled") !== "false",
      autoTagCreationEnabled:
        settingsMap.get("auto_tag_creation_enabled") !== "false",
    });
  }

  private buildAssignment(
    rows: ModelAssignmentRow[],
    role: string,
    defaults: SettingsState,
  ): ModelRoleAssignment {
    const row = rows.find((r) => r.role === role);
    if (!row)
      return defaults.modelAssignments[
        role as keyof typeof defaults.modelAssignments
      ];
    return {
      role: role as ModelRoleAssignment["role"],
      providerId: row.provider_id,
      modelFile: row.model_file,
      ...(row.params && { params: JSON.parse(row.params) }),
    };
  }

  saveSettings(settings: SettingsState): void {
    if (!this.db) throw new Error("Database not initialized");

    this._settings = settings;
    invalidateModelCache();

    const upsertSetting = this.db.prepare(
      "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
    );
    const deleteProviders = this.db.prepare("DELETE FROM user_providers");
    const insertProvider = this.db.prepare(
      "INSERT INTO user_providers (id, provider_dir, api_key, api_url_override) VALUES (?, ?, ?, ?)",
    );
    const deleteAssignments = this.db.prepare("DELETE FROM model_assignments");
    const insertAssignment = this.db.prepare(
      "INSERT INTO model_assignments (role, provider_id, model_file, params) VALUES (?, ?, ?, ?)",
    );

    const saveAll = this.db.transaction(() => {
      // Key-value settings
      upsertSetting.run(
        "use_same_model_for_agents",
        String(settings.useSameModelForAgents),
      );
      upsertSetting.run("log_level", settings.logLevel);
      upsertSetting.run("langfuse_enabled", String(settings.langfuse.enabled));
      upsertSetting.run(
        "langfuse_public_key",
        settings.langfuse.publicKey || "",
      );
      upsertSetting.run(
        "langfuse_secret_key",
        settings.langfuse.secretKey || "",
      );
      upsertSetting.run("langfuse_host", settings.langfuse.host || "");
      upsertSetting.run("auto_tag_enabled", String(settings.autoTagEnabled));
      upsertSetting.run(
        "auto_tag_creation_enabled",
        String(settings.autoTagCreationEnabled),
      );

      // Providers
      deleteProviders.run();
      for (const provider of settings.providers) {
        insertProvider.run(
          provider.id,
          provider.providerDir,
          provider.apiKey,
          provider.apiUrlOverride ?? null,
        );
      }

      // Model assignments
      deleteAssignments.run();
      for (const assignment of Object.values(settings.modelAssignments)) {
        if (assignment.providerId && assignment.modelFile) {
          insertAssignment.run(
            assignment.role,
            assignment.providerId,
            assignment.modelFile,
            assignment.params ? JSON.stringify(assignment.params) : null,
          );
        }
      }
    });

    saveAll();
  }

  async testConnection(config: TestConnectionConfig): Promise<void> {
    try {
      this.logger.info("testing connection", { config });

      sendInfo(
        "Testing Connection",
        `Testing ${config.modelFile} connection...`,
      );

      const definition = registry.getProvider(config.providerDir);
      if (!definition) {
        throw new Error(
          `Provider definition "${config.providerDir}" not found in registry`,
        );
      }

      const userProvider: UserProviderConfig = {
        id: "test-provider",
        providerDir: config.providerDir,
        apiKey: config.apiKey,
        ...(config.apiUrlOverride && { apiUrlOverride: config.apiUrlOverride }),
      };

      const provider = new Provider(userProvider, definition);
      const languageModel = provider.createLanguageModel(config.modelFile);

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
          `${config.modelFile} connected successfully! API is working correctly.`,
        );
      } else {
        this.logger.error("basic connection test failed - no response");
        sendAlert(
          "Connection Failed",
          `${config.modelFile} connection failed: No response from API`,
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error("connection test failed", { error: errorMessage });
      sendAlert(
        "Connection Failed",
        `${config.modelFile} connection failed: ${errorMessage}`,
      );
    }
  }

  isConfigured(): boolean {
    if (!this._settings || !this._settings.providers) return false;
    if (!this._settings.modelAssignments) return false;

    const chatAssignment = this._settings.modelAssignments.chat;
    if (!chatAssignment.providerId || !chatAssignment.modelFile) return false;

    const chatProvider = this._settings.providers.find(
      (p) => p.id === chatAssignment.providerId,
    );
    if (!chatProvider) return false;

    const definition = registry.getProvider(chatProvider.providerDir);
    if (!definition) return false;

    const provider = new Provider(chatProvider, definition);
    if (!provider.isConfigured()) return false;

    if (this._settings.useSameModelForAgents) {
      return true;
    }

    // Check simple and complex models
    for (const role of ["simple", "complex"] as const) {
      const assignment = this._settings.modelAssignments[role];
      if (!assignment.providerId || !assignment.modelFile) return false;

      if (assignment.providerId !== chatAssignment.providerId) {
        const p = this._settings.providers.find(
          (prov) => prov.id === assignment.providerId,
        );
        if (!p) return false;
        const def = registry.getProvider(p.providerDir);
        if (!def) return false;
        const prov = new Provider(p, def);
        if (!prov.isConfigured()) return false;
      }
    }

    return true;
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
