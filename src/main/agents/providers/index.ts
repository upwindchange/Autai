/**
 * Provider factory — creates LanguageModel instances.
 *
 * The per-thread chat model is chosen by the UI and threaded live into each
 * request as an explicit {providerId, modelId} selection — the DB is NOT read
 * for the per-thread decision at chat time. Global role assignments
 * (chat/simple/complex) and provider config (apiKey, baseURL, npm) still come
 * from the DB.
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
import type { UserProviderRow } from "@/db/types";
import { Provider } from "./provider";
import { sendAlert } from "@/utils/messageUtils";
import { i18n } from "@/i18n";

/** Build a LanguageModel from a configured provider row + model id. */
function modelFromProviderRow(
  providerRow: UserProviderRow,
  modelId: string,
): LanguageModel {
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

  return new Provider(config, runtimeConfig).createLanguageModel(modelId);
}

/** Resolve the global model assignment for a role (honors useSameModelForAgents). */
function assignmentForRole(role: ModelRole): {
  providerId: string;
  modelId: string;
} {
  const db = getDb();

  const sameModelRow = db
    .select()
    .from(settings)
    .where(eq(settings.key, "use_same_model_for_agents"))
    .get();
  const useSame = sameModelRow?.value !== "false";
  const effectiveRole: ModelRole = useSame && role !== "chat" ? "chat" : role;

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

  return { providerId: assignment.providerId, modelId: assignment.modelId };
}

/** Build a LanguageModel from an explicit provider+model selection. */
function resolveSelection(selection: {
  providerId: string;
  modelId: string;
}): LanguageModel {
  const db = getDb();
  const providerRow = db
    .select()
    .from(userProviders)
    .where(eq(userProviders.id, selection.providerId))
    .get();

  if (!providerRow) {
    sendAlert(
      i18n.t("agents.providerNotFoundTitle"),
      i18n.t("agents.providerNotFoundBody", {
        providerId: selection.providerId,
      }),
    );
    throw new Error(`Provider ${selection.providerId} not found`);
  }

  return modelFromProviderRow(providerRow, selection.modelId);
}

/** Resolve a model for a role using the global assignment. */
function createModel(role: ModelRole): LanguageModel {
  return resolveSelection(assignmentForRole(role));
}

/**
 * Resolve the chat model. An explicit `selection` (threaded live from the UI
 * per request) wins; otherwise fall back to the global chat assignment. A
 * construction failure on the explicit selection falls back to the global
 * default so a stale pick never hard-blocks the chat.
 */
export function chatModel(selection?: {
  providerId: string;
  modelId: string;
}): LanguageModel {
  if (selection && selection.providerId && selection.modelId) {
    try {
      return resolveSelection(selection);
    } catch {
      // fall through to the global default
    }
  }
  return createModel("chat");
}

export const simpleModel = (): LanguageModel => createModel("simple");
export const complexModel = (): LanguageModel => createModel("complex");

export { Provider } from "./provider";
