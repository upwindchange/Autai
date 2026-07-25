import { useAuiState } from "@assistant-ui/react";
import { useSettings } from "@/components/settings";
import { useThreadModelStore } from "@/stores/threadModelStore";
import { useConfiguredModels } from "./useConfiguredModels";
import type { ReasoningOption } from "@shared";

/**
 * Resolve the active chat thread's reasoning options (the catalog entry for the
 * selected model) so the thread-level settings panel can render the same
 * thinking controls the system-level settings card does. Mirrors
 * useThreadModelContextWindow's resolution: a per-thread override
 * (threadModelStore) wins, else the global chat assignment. Returns undefined
 * when the model isn't found in the configured list, or the catalog declares no
 * reasoning_options — in both cases the calling ModelParamsFields renders no
 * thinking UI.
 */
export function useThreadModelReasoning(): ReasoningOption[] | undefined {
  const mainThreadId = useAuiState((s) => s.threads.mainThreadId);
  const selection = useThreadModelStore((s) =>
    mainThreadId ? s.map[mainThreadId] : undefined,
  );
  const { settings } = useSettings();
  const { models } = useConfiguredModels();

  const providerId =
    selection?.providerId ?? settings.modelAssignments.chat.providerId;
  const modelId = selection?.modelId ?? settings.modelAssignments.chat.modelId;
  if (!providerId || !modelId) return undefined;

  return models.find(
    (m) => m.providerId === providerId && m.modelId === modelId,
  )?.reasoningOptions;
}
