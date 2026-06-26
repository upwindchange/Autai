import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAuiState } from "@assistant-ui/react";
import {
  ModelSelectorRoot,
  ModelSelectorTrigger,
  ModelSelectorContent,
  type ModelOption,
} from "@/components/assistant-ui/model-selector";
import { ProviderLogo } from "@/components/settings/provider-logo";
import { useConfiguredModels } from "@/hooks/useConfiguredModels";
import { useSettings } from "@/components/settings";
import { useThreadModelStore } from "@/stores/threadModelStore";
import { setThreadChatOverride } from "@/lib/tagApi";

// Pseudo-option id that clears a thread's override (revert to the global default).
const USE_DEFAULT_ID = "__default__";

/**
 * Header model selector: lets the active thread pick its own chat model from
 * the configured providers. The selection lives in RAM (threadModelStore) and
 * is sent live to the backend per request; the PATCH only persists it for the
 * next reload (and is a no-op for a brand-new, not-yet-saved thread — the
 * first-save write covers that). The trigger updates INSTANTLY on pick.
 *
 * Keyed by `threads.mainThreadId` (the active thread id) — the same value the
 * transport sends as `sessionId` at send time, so store key and request key match.
 */
export function HeaderModelSelector() {
  const { t } = useTranslation("common");
  const currentRemoteId = useAuiState((s) => s.threads.mainThreadId);
  const selection = useThreadModelStore((s) =>
    currentRemoteId ? s.map[currentRemoteId] : undefined,
  );
  const { settings } = useSettings();
  const { models } = useConfiguredModels();

  const options = useMemo<ModelOption[]>(() => {
    const modelOptions: ModelOption[] = models.map((m) => ({
      id: `${m.providerId}::${m.modelId}`,
      name: m.modelName,
      description: m.providerName,
      icon: <ProviderLogo logo={m.logo} />,
    }));
    return [
      { id: USE_DEFAULT_ID, name: t("header.modelSelector.useDefault") },
      ...modelOptions,
    ];
  }, [models, t]);

  // Effective: per-thread override wins, else the global chat assignment.
  const activeProviderId =
    selection?.providerId ?? settings.modelAssignments.chat.providerId;
  const activeModelId =
    selection?.modelId ?? settings.modelAssignments.chat.modelId;
  const effectiveId =
    activeProviderId && activeModelId ?
      `${activeProviderId}::${activeModelId}`
    : null;
  // Guard: if the effective model isn't in the list (provider removed), show
  // the default entry so the trigger always renders a known option.
  const value =
    effectiveId && options.some((o) => o.id === effectiveId) ?
      effectiveId
    : USE_DEFAULT_ID;

  const handleSelect = (compositeId: string) => {
    if (!currentRemoteId) return;

    if (compositeId === USE_DEFAULT_ID) {
      // Instant UI first, then persist.
      useThreadModelStore
        .getState()
        .set(currentRemoteId, { providerId: null, modelId: null });
      void setThreadChatOverride(currentRemoteId, {
        providerId: null,
        modelId: null,
      }).catch(() => {});
      return;
    }

    const sepIdx = compositeId.indexOf("::");
    if (sepIdx < 0) return;
    const providerId = compositeId.slice(0, sepIdx);
    const modelId = compositeId.slice(sepIdx + 2);
    useThreadModelStore
      .getState()
      .set(currentRemoteId, { providerId, modelId });
    void setThreadChatOverride(currentRemoteId, {
      providerId,
      modelId,
    }).catch(() => {});
  };

  if (models.length === 0) return null;

  return (
    <ModelSelectorRoot
      models={options}
      value={value}
      onValueChange={handleSelect}
    >
      <ModelSelectorTrigger variant="outline" size="sm" />
      <ModelSelectorContent />
    </ModelSelectorRoot>
  );
}
