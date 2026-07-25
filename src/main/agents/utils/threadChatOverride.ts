/**
 * Resolve a thread's per-chat model override from the DB, validating the
 * provider/model against the live registry and purging stale entries.
 *
 * This is the single source of truth for "what model + params + system prompt
 * should this chat run use" — shared by:
 *   - `GET /threads/:id/model` (drives the renderer's picker display cache), and
 *   - `POST /chat` (resolves the model at send time, replacing the old
 *     client-injected X-Chat-* headers and system/modelParams body fields).
 *
 * Returns `null`-typed fields when there is no thread, no override, or the
 * override was stale (the stale provider/model are purged but params/systemPrompt
 * are preserved — they're independent of model identity and the user may re-pick).
 */
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { userProviders } from "@/db/schema";
import * as registry from "@agents/providers/registry";
import { threadPersistenceService } from "@/services";
import { sendInfo } from "@/utils/messageUtils";
import { i18n } from "@/i18n";
import type { ModelParameters } from "@shared";
import log from "electron-log/main";

const logger = log.scope("ThreadChatOverride");

export interface ResolvedChatOverride {
  providerId: string | null;
  modelId: string | null;
  params: ModelParameters | null;
  systemPrompt: string | null;
}

const EMPTY: ResolvedChatOverride = {
  providerId: null,
  modelId: null,
  params: null,
  systemPrompt: null,
};

export function resolveChatOverride(
  threadId: string | null | undefined,
): ResolvedChatOverride {
  if (!threadId) return EMPTY;
  const thread = threadPersistenceService.getThread(threadId);
  if (!thread || !thread.chatProviderId || !thread.chatModelId) return EMPTY;

  const db = getDb();
  const providerRow = db
    .select()
    .from(userProviders)
    .where(eq(userProviders.id, thread.chatProviderId))
    .get();
  const valid =
    !!providerRow &&
    registry
      .getModels(providerRow.providerDir)
      .some((m) => m.file === thread.chatModelId);

  const params =
    thread.chatModelParams ?
      (() => {
        try {
          return JSON.parse(thread.chatModelParams) as ModelParameters;
        } catch {
          return null;
        }
      })()
    : null;
  const systemPrompt = thread.chatSystemPrompt;

  if (!valid) {
    // Purge the invalid provider/model but keep params/systemPrompt — they're
    // independent of the model identity and the user may re-pick a model.
    sendInfo(
      i18n.t("agents.modelUnavailableTitle"),
      i18n.t("agents.modelUnavailableBody"),
    );
    threadPersistenceService.setThreadChatOverride(threadId, {
      providerId: null,
      modelId: null,
      params,
      systemPrompt,
    });
    return { providerId: null, modelId: null, params, systemPrompt };
  }

  logger.debug("resolved chat override", {
    threadId,
    providerId: thread.chatProviderId,
    modelId: thread.chatModelId,
    hasParams: !!params,
    hasSystemPrompt: !!systemPrompt,
  });
  return {
    providerId: thread.chatProviderId,
    modelId: thread.chatModelId,
    params,
    systemPrompt,
  };
}
