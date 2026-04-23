/**
 * Provider factory — creates LanguageModel instances from the database.
 * No file reads, no registry, no RAM caching. DB is the sole source of truth.
 *
 * Consumed by workers via chatModel(), simpleModel(), complexModel().
 */

import { eq } from "drizzle-orm";
import type { LanguageModel } from "ai";
import type {
  ModelRole,
  ProviderRuntimeConfig,
  UserProviderConfig,
} from "@shared";
import { getDb } from "@/db";
import { settings, userProviders, modelAssignments } from "@/db/schema";
import { Provider } from "./provider";
import { sendAlert } from "@/utils/messageUtils";
import { i18n } from "@/i18n";

/**
 * Resolves a model role (chat/simple/complex) to a LanguageModel.
 * Reads directly from DB — no file I/O, no caching.
 */
function createModel(role: ModelRole): LanguageModel {
  const db = getDb();

  // Check useSameModelForAgents setting
  const sameModelRow = db
    .select()
    .from(settings)
    .where(eq(settings.key, "use_same_model_for_agents"))
    .get();
  const useSame = sameModelRow?.value !== "false";

  const effectiveRole: ModelRole = useSame && role !== "chat" ? "chat" : role;

  // Get model assignment
  const assignment = db
    .select()
    .from(modelAssignments)
    .where(eq(modelAssignments.role, effectiveRole))
    .get();

  if (!assignment || !assignment.providerId || !assignment.modelId) {
    sendAlert(
      i18n.t("agents.modelNotConfiguredTitle"),
      i18n.t("agents.modelNotConfiguredBody", { role: effectiveRole }),
    );
    throw new Error(`No model assignment for role: ${effectiveRole}`);
  }

  // Get provider from DB
  const providerRow = db
    .select()
    .from(userProviders)
    .where(eq(userProviders.id, assignment.providerId))
    .get();

  if (!providerRow) {
    sendAlert(
      i18n.t("agents.providerNotFoundTitle"),
      i18n.t("agents.providerNotFoundBody", { providerId: assignment.providerId }),
    );
    throw new Error(`Provider ${assignment.providerId} not found`);
  }

  const config: UserProviderConfig = {
    id: providerRow.id,
    providerDir: providerRow.providerDir,
    apiKey: providerRow.apiKey,
    ...(providerRow.apiUrlOverride && {
      apiUrlOverride: providerRow.apiUrlOverride,
    }),
    npm: providerRow.npm,
    ...(providerRow.defaultApiUrl && {
      defaultApiUrl: providerRow.defaultApiUrl,
    }),
  };

  const runtimeConfig: ProviderRuntimeConfig = {
    npm: providerRow.npm,
    ...(providerRow.defaultApiUrl && {
      defaultApiUrl: providerRow.defaultApiUrl,
    }),
    name: providerRow.providerDir,
  };

  const provider = new Provider(config, runtimeConfig);
  return provider.createLanguageModel(assignment.modelId);
}

export const chatModel = (): LanguageModel => createModel("chat");
export const simpleModel = (): LanguageModel => createModel("simple");
export const complexModel = (): LanguageModel => createModel("complex");

export { Provider } from "./provider";
