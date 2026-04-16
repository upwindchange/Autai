/**
 * Provider factory — creates LanguageModel instances from the TOML-driven registry.
 * Consumed by workers via chatModel(), simpleModel(), complexModel().
 */

import type { LanguageModel } from "ai";
import type { UserProviderConfig, ModelRole } from "@shared";
import { settingsService } from "@/services";
import * as registry from "./registry";
import { Provider } from "./provider";
import { sendAlert } from "@/utils/messageUtils";

/**
 * Resolves a model role (chat/simple/complex) to a LanguageModel.
 */
function createModel(role: ModelRole): LanguageModel {
  const settings = settingsService.settings;
  if (!settings || !settings.providers || settings.providers.length === 0) {
    sendAlert(
      "No Providers Configured",
      "Please configure at least one provider in settings before using AI features.",
    );
    throw new Error("No providers configured");
  }

  // If useSameModelForAgents, use chat model for simple/complex too
  const effectiveRole: ModelRole =
    settings.useSameModelForAgents && role !== "chat" ? "chat" : role;

  const assignment = settings.modelAssignments?.[effectiveRole];
  if (!assignment || !assignment.providerId || !assignment.modelFile) {
    sendAlert(
      "Model Not Configured",
      `No ${effectiveRole} model assigned. Please configure it in settings.`,
    );
    throw new Error(`No model assignment for role: ${effectiveRole}`);
  }

  const userProvider = settings.providers.find(
    (p: UserProviderConfig) => p.id === assignment.providerId,
  );
  if (!userProvider) {
    sendAlert(
      "Provider Not Found",
      `Provider "${assignment.providerId}" not found. Please check your settings.`,
    );
    throw new Error(`Provider ${assignment.providerId} not found`);
  }

  const definition = registry.getProvider(userProvider.providerDir);
  if (!definition) {
    sendAlert(
      "Provider Definition Not Found",
      `Provider definition "${userProvider.providerDir}" not found in registry. ` +
        "This may happen if the provider's TOML files are missing.",
    );
    throw new Error(
      `Provider definition not found: ${userProvider.providerDir}`,
    );
  }

  const provider = new Provider(userProvider, definition);
  return provider.createLanguageModel(assignment.modelFile);
}

// ──────────────────────────────────────────────
// Singleton model instances (invalidated on settings change)
// ──────────────────────────────────────────────

let _chatModel: LanguageModel | null = null;
let _simpleModel: LanguageModel | null = null;
let _complexModel: LanguageModel | null = null;

export function invalidateModelCache(): void {
  _chatModel = null;
  _simpleModel = null;
  _complexModel = null;
}

export const chatModel = (): LanguageModel => {
  if (!_chatModel) {
    _chatModel = createModel("chat");
  }
  return _chatModel;
};

export const simpleModel = (): LanguageModel => {
  if (!_simpleModel) {
    _simpleModel = createModel("simple");
  }
  return _simpleModel;
};

export const complexModel = (): LanguageModel => {
  if (!_complexModel) {
    _complexModel = createModel("complex");
  }
  return _complexModel;
};

// Re-export for convenience
export { Provider } from "./provider";
export { initialize as initializeRegistry, getAllProviders, getProvider, getModels } from "./registry";
