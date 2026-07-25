import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useAuiState } from "@assistant-ui/react";
import { Check, ChevronDown, Cpu } from "lucide-react";
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
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { cn } from "@/lib/utils";

// Pseudo-option id that clears a thread's override (revert to the global default).
const USE_DEFAULT_ID = "__default__";

// Fallback icon for the "Use default" option (no provider logo of its own).
const DEFAULT_ICON = <Cpu className="size-4 text-muted-foreground" />;

/**
 * Header model selector: lets the active thread pick its own chat model from
 * the configured providers. The selection lives in RAM (threadModelStore) as a
 * DISPLAY cache and is persisted to the thread row immediately via PATCH on
 * every pick (awaited, so the server's DB read at send time always sees it).
 * The backend resolves the override server-side from the thread id — this store
 * no longer participates in the send path, only in the picker's instant render.
 * The trigger updates INSTANTLY on pick (synchronous Zustand set).
 *
 * Keyed by `threads.mainThreadId` (the active thread id) — the same id the
 * transport sends as `X-Session-Id`, which the server uses to resolve the
 * override.
 *
 * Responsive: the trigger keeps its logo + model name at all header widths
 * (truncating if needed); the narrow-layout disclosure is handled by the
 * title/theme/split controls in the header, not here. Desktop opens the cmdk
 * Popover (downward); mobile opens a top-anchored Drawer ("topdown" sheet)
 * since the selector sits in the header.
 */
export function HeaderModelSelector() {
  const { t } = useTranslation("common");
  const isMobile = useIsMobile();
  const currentRemoteId = useAuiState((s) => s.threads.mainThreadId);
  const selection = useThreadModelStore((s) =>
    currentRemoteId ? s.map[currentRemoteId] : undefined,
  );
  const { settings } = useSettings();
  const { models } = useConfiguredModels();

  const [mobileOpen, setMobileOpen] = useState(false);

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

  const handleSelect = async (compositeId: string) => {
    if (!currentRemoteId) return;
    // Preserve the existing params/systemPrompt so picking a model doesn't
    // silently wipe an unrelated thread-level override.
    const prev = useThreadModelStore.getState().get(currentRemoteId);

    // The server resolves the override from the DB at send time (no longer from
    // client-injected headers), so the PATCH must land before the next send can
    // read it. Instant UI update first (the picker closes on select anyway), then
    // await the persist — a sub-100ms cost that closes the pick-then-send race.
    if (compositeId === USE_DEFAULT_ID) {
      useThreadModelStore.getState().set(currentRemoteId, {
        providerId: null,
        modelId: null,
        params: prev?.params ?? null,
        systemPrompt: prev?.systemPrompt ?? null,
      });
      await setThreadChatOverride(currentRemoteId, {
        providerId: null,
        modelId: null,
        params: prev?.params ?? null,
        systemPrompt: prev?.systemPrompt ?? null,
      }).catch(() => {});
      return;
    }

    const sepIdx = compositeId.indexOf("::");
    if (sepIdx < 0) return;
    const providerId = compositeId.slice(0, sepIdx);
    const modelId = compositeId.slice(sepIdx + 2);
    useThreadModelStore.getState().set(currentRemoteId, {
      providerId,
      modelId,
      params: prev?.params ?? null,
      systemPrompt: prev?.systemPrompt ?? null,
    });
    await setThreadChatOverride(currentRemoteId, {
      providerId,
      modelId,
      params: prev?.params ?? null,
      systemPrompt: prev?.systemPrompt ?? null,
    }).catch(() => {});
  };

  if (models.length === 0) return null;

  const selected = options.find((o) => o.id === value);

  // Trigger body shared by desktop + mobile: provider logo + model name, always
  // shown (the name truncates if the header is tight). The header's progressive
  // disclosure does not touch the model selector.
  const triggerBody: ReactNode = (
    <>
      <span className="flex size-4 shrink-0 items-center justify-center [&_svg]:size-4">
        {selected?.icon ?? DEFAULT_ICON}
      </span>
      <span className="max-w-40 truncate font-medium">
        {selected?.name ?? t("header.modelSelector.useDefault")}
      </span>
    </>
  );

  if (isMobile) {
    return (
      <Drawer open={mobileOpen} onOpenChange={setMobileOpen} direction="top">
        <DrawerTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-2 px-2.5 py-1.5 text-xs"
          >
            {triggerBody}
            <ChevronDown className="size-4 opacity-50" />
          </Button>
        </DrawerTrigger>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader className="text-left">
            <DrawerTitle>{t("header.modelSelector.title")}</DrawerTitle>
          </DrawerHeader>
          <div className="relative overflow-y-auto px-2 pb-4">
            {options.map((opt) => {
              const isActive = opt.id === value;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    handleSelect(opt.id);
                    setMobileOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                    isActive ?
                      "bg-accent text-accent-foreground"
                    : "hover:bg-accent/50",
                  )}
                >
                  <span className="flex size-4 shrink-0 items-center justify-center [&_svg]:size-4">
                    {opt.icon ?? DEFAULT_ICON}
                  </span>
                  <span className="flex-1 truncate">{opt.name}</span>
                  {isActive && <Check className="size-4 text-primary" />}
                </button>
              );
            })}
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <ModelSelectorRoot
      models={options}
      value={value}
      onValueChange={handleSelect}
    >
      <ModelSelectorTrigger variant="outline" size="sm">
        {triggerBody}
      </ModelSelectorTrigger>
      <ModelSelectorContent />
    </ModelSelectorRoot>
  );
}
