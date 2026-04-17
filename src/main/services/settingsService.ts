/**
 * Settings Service — manages provider configurations and model assignments.
 * Driven by the TOML provider registry (no hardcoded provider types).
 */

import { generateText } from "ai";
import { Provider } from "@agents/providers/provider";
import * as registry from "@agents/providers/registry";
import { invalidateModelCache } from "@agents/providers";
import { sendSuccess, sendAlert, sendInfo } from "@/utils/messageUtils";
import { getDb } from "@/db";
import { settings, userProviders, modelAssignments } from "@/db/schema";
import log from "electron-log/main";
import type {
  SettingsState,
  TestConnectionConfig,
  UserProviderConfig,
  ModelRoleAssignment,
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

  async initialize(): Promise<void> {
    await this.loadSettings();
  }

  private async loadSettings(): Promise<void> {
    const db = getDb();
    const defaults = SettingsStateSchema.parse({});

    // Load key-value settings
    const settingsRows = await db.select().from(settings);
    const settingsMap = new Map(settingsRows.map((r) => [r.key, r.value]));

    // Load user providers
    const providerRows = (await db.select().from(userProviders)) as UserProviderRow[];

    const providers: UserProviderConfig[] = providerRows.map((row) => ({
      id: row.id,
      providerDir: row.providerDir,
      apiKey: row.apiKey,
      ...(row.apiUrlOverride && { apiUrlOverride: row.apiUrlOverride }),
    }));

    // Load model assignments
    const assignmentRows = (await db.select().from(modelAssignments)) as ModelAssignmentRow[];

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
      modelFile: row.modelFile,
      ...(row.params && { params: JSON.parse(row.params) }),
    };
  }

  async saveSettings(settingsState: SettingsState): Promise<void> {
    const db = getDb();
    this._settings = settingsState;
    invalidateModelCache();

    await db.transaction(async (tx) => {
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
      ] as [string, string][]) {
        await tx
          .insert(settings)
          .values({ key, value })
          .onConflictDoUpdate({ target: settings.key, set: { value } });
      }

      // Providers
      await tx.delete(userProviders);
      for (const provider of settingsState.providers) {
        await tx.insert(userProviders).values({
          id: provider.id,
          providerDir: provider.providerDir,
          apiKey: provider.apiKey,
          apiUrlOverride: provider.apiUrlOverride ?? null,
        });
      }

      // Model assignments
      await tx.delete(modelAssignments);
      for (const assignment of Object.values(settingsState.modelAssignments)) {
        if (assignment.providerId && assignment.modelFile) {
          await tx.insert(modelAssignments).values({
            role: assignment.role,
            providerId: assignment.providerId,
            modelFile: assignment.modelFile,
            params: assignment.params
              ? JSON.stringify(assignment.params)
              : null,
          });
        }
      }
    });
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
}

export const settingsService = new SettingsService();
