/**
 * Settings Service — manages provider configurations and model assignments.
 * All data persisted to and read from SQLite. No file I/O for provider definitions.
 */

import { generateText } from "ai";
import { Provider } from "@agents/providers/provider";
import { sendSuccess, sendAlert, sendInfo } from "@/utils/messageUtils";
import { getDb } from "@/db";
import { settings, userProviders, modelAssignments } from "@/db/schema";
import log from "electron-log/main";
import type {
  SettingsState,
  TestConnectionConfig,
  UserProviderConfig,
  ModelRoleAssignment,
  ProviderRuntimeConfig,
} from "@shared";
import { SettingsStateSchema } from "@shared";
import type { UserProviderRow, ModelAssignmentRow } from "@/db/types";

class SettingsService {
  private _settings: SettingsState;
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
    this.loadSettings();
  }

  private loadSettings(): void {
    const db = getDb();
    const defaults = SettingsStateSchema.parse({});

    // Load key-value settings
    const settingsRows = db.select().from(settings).all();
    const settingsMap = new Map(settingsRows.map((r) => [r.key, r.value]));

    // Load user providers
    const providerRows = db.select().from(userProviders).all() as UserProviderRow[];

    const providers: UserProviderConfig[] = providerRows.map((row) => ({
      id: row.id,
      providerDir: row.providerDir,
      apiKey: row.apiKey,
      ...(row.apiUrlOverride && { apiUrlOverride: row.apiUrlOverride }),
      npm: row.npm,
      ...(row.defaultApiUrl && { defaultApiUrl: row.defaultApiUrl }),
    }));

    // Load model assignments
    const assignmentRows = db.select().from(modelAssignments).all() as ModelAssignmentRow[];

    const modelAssignmentsObj = {
      chat: this.buildAssignment(assignmentRows, "chat", defaults),
      simple: this.buildAssignment(assignmentRows, "simple", defaults),
      complex: this.buildAssignment(assignmentRows, "complex", defaults),
    };

    this._settings = SettingsStateSchema.parse({
      providers: providers.length > 0 ? providers : defaults.providers,
      modelAssignments: modelAssignmentsObj,
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
      systemPrompt: settingsMap.get("system_prompt") || defaults.systemPrompt,
      language: settingsMap.get("language") || defaults.language,
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
      providerId: row.providerId,
      modelId: row.modelId,
      ...(row.params && { params: JSON.parse(row.params) }),
    };
  }

  saveSettings(settingsState: SettingsState): void {
    const db = getDb();
    this._settings = settingsState;

    db.transaction((tx) => {
      // Key-value settings
      for (const [key, value] of [
        ["use_same_model_for_agents", String(settingsState.useSameModelForAgents)],
        ["log_level", settingsState.logLevel],
        ["langfuse_enabled", String(settingsState.langfuse.enabled)],
        ["langfuse_public_key", settingsState.langfuse.publicKey || ""],
        ["langfuse_secret_key", settingsState.langfuse.secretKey || ""],
        ["langfuse_host", settingsState.langfuse.host || ""],
        ["auto_tag_enabled", String(settingsState.autoTagEnabled)],
        ["auto_tag_creation_enabled", String(settingsState.autoTagCreationEnabled)],
        ["system_prompt", settingsState.systemPrompt || ""],
        ["language", settingsState.language || "en"],
      ] as [string, string][]) {
        tx.insert(settings)
          .values({ key, value })
          .onConflictDoUpdate({ target: settings.key, set: { value } })
          .run();
      }

      // Providers
      tx.delete(userProviders).run();
      for (const provider of settingsState.providers) {
        tx.insert(userProviders)
          .values({
            id: provider.id,
            providerDir: provider.providerDir,
            apiKey: provider.apiKey,
            apiUrlOverride: provider.apiUrlOverride ?? null,
            npm: provider.npm,
            defaultApiUrl: provider.defaultApiUrl ?? null,
          })
          .run();
      }

      // Model assignments
      tx.delete(modelAssignments).run();
      for (const assignment of Object.values(settingsState.modelAssignments)) {
        if (assignment.providerId && assignment.modelId) {
          tx.insert(modelAssignments)
            .values({
              role: assignment.role,
              providerId: assignment.providerId,
              modelId: assignment.modelId,
              params: assignment.params
                ? JSON.stringify(assignment.params)
                : null,
            })
            .run();
        }
      }
    });
  }

  async testConnection(config: TestConnectionConfig): Promise<void> {
    try {
      this.logger.info("testing connection", { config });

      sendInfo(
        "Testing Connection",
        `Testing ${config.modelId} connection...`,
      );

      const userProvider: UserProviderConfig = {
        id: "test-provider",
        providerDir: config.providerDir,
        apiKey: config.apiKey,
        ...(config.apiUrlOverride && { apiUrlOverride: config.apiUrlOverride }),
        npm: config.npm,
        ...(config.defaultApiUrl && { defaultApiUrl: config.defaultApiUrl }),
      };

      const runtimeConfig: ProviderRuntimeConfig = {
        npm: config.npm,
        ...(config.defaultApiUrl && { defaultApiUrl: config.defaultApiUrl }),
        name: config.providerDir,
      };

      const provider = new Provider(userProvider, runtimeConfig);
      const languageModel = provider.createLanguageModel(config.modelId);

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
          `${config.modelId} connected successfully! API is working correctly.`,
        );
      } else {
        this.logger.error("basic connection test failed - no response");
        sendAlert(
          "Connection Failed",
          `${config.modelId} connection failed: No response from API`,
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error("connection test failed", { error: errorMessage });
      sendAlert(
        "Connection Failed",
        `${config.modelId} connection failed: ${errorMessage}`,
      );
    }
  }

  isConfigured(): boolean {
    if (!this._settings || !this._settings.providers) return false;
    if (!this._settings.modelAssignments) return false;

    const chatAssignment = this._settings.modelAssignments.chat;
    if (!chatAssignment.providerId || !chatAssignment.modelId) return false;

    const chatProvider = this._settings.providers.find(
      (p) => p.id === chatAssignment.providerId,
    );
    if (!chatProvider) return false;
    if (!chatProvider.apiKey?.trim()) return false;

    if (this._settings.useSameModelForAgents) {
      return true;
    }

    for (const role of ["simple", "complex"] as const) {
      const assignment = this._settings.modelAssignments[role];
      if (!assignment.providerId || !assignment.modelId) return false;

      if (assignment.providerId !== chatAssignment.providerId) {
        const p = this._settings.providers.find(
          (prov) => prov.id === assignment.providerId,
        );
        if (!p?.apiKey?.trim()) return false;
      }
    }

    return true;
  }
}

export const settingsService = new SettingsService();
