import { useAuiState } from "@assistant-ui/react";
import { useSettings } from "@/components/settings";
import { useThreadModelStore } from "@/stores/threadModelStore";
import { useConfiguredModels } from "./useConfiguredModels";

/**
 * Resolve the active chat thread's model context window (tokens) for the
 * ContextDisplay denominator. Mirrors HeaderModelSelector's resolution: a
 * per-thread override (threadModelStore) wins, else the global chat assignment.
 * The limit comes from GET /providers/configured/models (catalog TOML limit, or
 * a manual override for openai-compatible). Returns undefined when the model
 * isn't found in the configured list (e.g. still loading, or removed provider).
 */
export function useThreadModelContextWindow(): number | undefined {
  const mainThreadId = useAuiState((s) => s.threads.mainThreadId);
  const selection = useThreadModelStore((s) =>
    mainThreadId ? s.map[mainThreadId] : undefined,
  );
  const { settings } = useSettings();
  const { models } = useConfiguredModels();

  const providerId =
    selection?.providerId ?? settings.modelAssignments.chat.providerId;
  const modelId =
    selection?.modelId ?? settings.modelAssignments.chat.modelId;
  if (!providerId || !modelId) return undefined;

  return models.find(
    (m) => m.providerId === providerId && m.modelId === modelId,
  )?.limit?.context;
}
