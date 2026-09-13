/**
 * Provider factory — creates LanguageModel instances.
 *
 * The per-thread chat model is chosen by the UI and threaded live into each
 * request as an explicit {providerId, modelId} selection — the DB is NOT read
 * for the per-thread decision at chat time. Global role assignments
 * (chat/simple/complex) and provider config (apiKey, baseURL, npm) still come
 * from the DB.
 *
 * The AI SDK's `LanguageModel` interface exposes no context-window / max-output
 * metadata (no `contextWindow` property; `maxOutputTokens` is only a per-call
 * generation cap). So resolution yields a `ResolvedModel` — the SDK model plus
 * the two catalog facts about it — assembled in the same pass that builds the
 * model. Limits originate from the TOML catalog `limit.{context,output}`; for
 * models with no TOML (openai-compatible), a user-entered manual override is
 * used instead. See `ModelOverride` (@shared/providers).
 */

import { eq } from "drizzle-orm";
import type { LanguageModel } from "ai";
import type {
  ModelParameters,
  ModelRole,
  ProviderRuntimeConfig,
  UserProviderConfig,
} from "@shared";
import { getDb } from "@/db";
import { settings, userProviders, modelAssignments } from "@/db/schema";
import type { UserProviderRow } from "@/db/types";
import { Provider } from "./provider";
import { getModels } from "./registry";
import { settingsService } from "@/services/settingsService";
import { sendAlert, sendWarning } from "@/utils/messageUtils";
import { i18n } from "@/i18n";
import log from "electron-log/main";

const logger = log.scope("Providers");

/**
 * Conservative fallback when a TOML provider's model file is *itself* missing
 * `limit`. This is the ONE and only backend fallback: the openai-compatible
 * case (no TOML) is handled by a user-entered override that the frontend
 * persists as a concrete value (128k by default) before it reaches here, so
 * `ResolvedModel.contextWindow` is otherwise always defined. A hit here means a
 * catalog gap — surfaced to the user via sendWarning.
 */
export const FALLBACK_CONTEXT_TOKENS = 128_000;

/**
 * Models are resolved on every chat turn, title/tag generation, and agent
 * step — so a model lacking a context-window limit would otherwise trigger the
 * "context window unknown" warning dozens of times per session. Each unique
 * `provider:model` gap is one distinct issue, so dedupe to the first occurrence
 * per process lifetime. (If the user later adds an override, the guard itself
 * goes false and nothing fires.)
 */
const warnedUnknownContext = new Set<string>();

/**
 * A fully resolved model: the runnable SDK object plus its catalog/override
 * limits and the per-role params + SDK npm string needed to build
 * `providerOptions` at the call site. `contextWindow` is always a concrete
 * number (backend fallback only for a TOML model lacking `limit`);
 * `maxOutputTokens` is optional because not every call wants an output cap.
 */
export type ResolvedModel = {
  /** Pass to streamText/generateText as `model`. */
  model: LanguageModel;
  /** Max input context (tokens) — catalog `limit.context` or manual override. */
  contextWindow: number;
  /** Max output tokens — catalog `limit.output` or manual override. Optional. */
  maxOutputTokens?: number;
  /** SDK npm package (e.g. `@ai-sdk/openai-compatible`) — translator dispatch key. */
  npm: string;
  /** Per-role params from `model_assignments.params` (reasoning selection, etc.). */
  params?: ModelParameters;
};

/**
 * Build a ResolvedModel from a configured provider row + model id. Limits come
 * from (in priority order): the TOML catalog `limit`, then a user-entered
 * manual override (for no-TOML models like openai-compatible). If neither has a
 * `context` value (a TOML model file itself lacking `limit` — the only backend
 * fallback), FALLBACK_CONTEXT_TOKENS is used and the user is warned.
 *
 * `params` is optional per-role reasoning/sampling config; when omitted the
 * model resolves with no per-role overrides (e.g. the per-thread chat path,
 * which threads its own params through the request body instead).
 */
function modelFromProviderRow(
  providerRow: UserProviderRow,
  modelId: string,
  params?: ModelParameters,
): ResolvedModel {
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

  const model = new Provider(config, runtimeConfig).createLanguageModel(
    modelId,
  );

  // Resolve limits: TOML catalog first, then the user-entered override for
  // no-TOML models. `contextWindow` is the only one that ever falls back.
  const tomlLimit = getModels(providerRow.providerDir).find(
    (m) => m.file === modelId,
  )?.limit;
  const override = settingsService.getModelOverride(providerRow.id, modelId);

  const contextWindow =
    tomlLimit?.context ?? override?.contextWindow ?? FALLBACK_CONTEXT_TOKENS;
  if (!tomlLimit?.context && !override?.contextWindow) {
    // Catalog gap: a model with neither a TOML limit nor a manual override.
    // The openai-compatible case is expected to carry an override (the frontend
    // persists 128k by default), so reaching here most likely means a TOML
    // provider shipped a model file without a [limit] block.
    const warnKey = `${providerRow.providerDir}:${modelId}`;
    if (!warnedUnknownContext.has(warnKey)) {
      warnedUnknownContext.add(warnKey);
      sendWarning(
        i18n.t("agents.contextWindowUnknownTitle"),
        i18n.t("agents.contextWindowUnknownBody", {
          provider: providerRow.providerDir,
          model: modelId,
          fallback: String(FALLBACK_CONTEXT_TOKENS),
        }),
      );
    }
  }

  const maxOutputTokens = tomlLimit?.output ?? override?.maxOutputTokens;

  return {
    model,
    contextWindow,
    npm: providerRow.npm,
    ...(maxOutputTokens && { maxOutputTokens }),
    ...(params && { params }),
  };
}

/**
 * Resolve the global model assignment for a role.
 *
 * `useSameModelForAgents` mirrors only the MODEL (providerId + modelId) from
 * the chat role into simple/complex — the agent roles keep their OWN params
 * (temperature, reasoning selection, etc.). So even when an agent shares the
 * chat model, its sampling/thinking config is independently settable. This
 * reads the model from the effective (possibly mirrored) role, then reads
 * params from the AGENT role's own row when mirroring.
 */
function assignmentForRole(role: ModelRole): {
  providerId: string;
  modelId: string;
  params?: ModelParameters;
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

  // When the model is mirrored from chat, the agent's params still come from
  // the agent role's own row (which may be empty → falls back to defaults).
  const paramsRow =
    useSame && role !== "chat" ?
      db
        .select()
        .from(modelAssignments)
        .where(eq(modelAssignments.role, role))
        .get()
    : assignment;

  let params: ModelParameters | undefined;
  if (paramsRow?.params) {
    try {
      params = JSON.parse(paramsRow.params) as ModelParameters;
    } catch {
      logger.warn("model_assignments.params is not valid JSON; ignoring", {
        role,
      });
    }
  }

  return {
    providerId: assignment.providerId,
    modelId: assignment.modelId,
    params,
  };
}

/** Build a ResolvedModel from an explicit provider+model selection. */
function resolveSelection(selection: {
  providerId: string;
  modelId: string;
  params?: ModelParameters;
}): ResolvedModel {
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

  return modelFromProviderRow(providerRow, selection.modelId, selection.params);
}

/** Resolve a model for a role using the global assignment. */
function createModel(role: ModelRole): ResolvedModel {
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
}): ResolvedModel {
  if (selection && selection.providerId && selection.modelId) {
    try {
      return resolveSelection(selection);
    } catch {
      // fall through to the global default
    }
  }
  return createModel("chat");
}

export const simpleModel = (): ResolvedModel => createModel("simple");
export const complexModel = (): ResolvedModel => createModel("complex");

// ──────────────────────────────────────────────
// Reasoning / sampling param translation
// ──────────────────────────────────────────────




/**
 * Map a ModelParameters object to the sampling-param subset that streamText
 * accepts directly (temperature, maxTokens→maxOutputTokens, etc.). Returns an
 * empty object when params is absent so it spreads harmlessly. Mirrors the
 * mapping chatWorker already does inline; extracted so the entertainment
 * workers (which currently forward no params) can apply per-role defaults too.
 */
export function forwardSamplingParams(
  params: ModelParameters | undefined,
): Record<string, unknown> {
  if (!params) return {};
  const out: Record<string, unknown> = {};
  if (params.temperature != null) out.temperature = params.temperature;
  if (params.maxTokens != null) out.maxOutputTokens = params.maxTokens;
  if (params.topP != null) out.topP = params.topP;
  if (params.topK != null) out.topK = params.topK;
  if (params.frequencyPenalty != null)
    out.frequencyPenalty = params.frequencyPenalty;
  if (params.presencePenalty != null)
    out.presencePenalty = params.presencePenalty;
  if (params.stopSequences && params.stopSequences.length > 0)
    out.stopSequences = params.stopSequences;
  return out;
}

export {
  providerOptionsNamespace,
  type ProviderOptionControls,
  customProviderOptions,
} from "./options";
export { Provider } from "./provider";
