import { type FC } from "react";
import { useTranslation } from "react-i18next";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DotMatrix } from "@/components/assistant-ui/dot-matrix";
import { useSettings } from "@/components/settings";
import { useUiStore } from "@/stores/uiStore";

/**
 * Whether both agent roles resolve to a configured (provider, model) pair —
 * same effective rule as the backend factory (useSameModelForAgents mirrors
 * chat onto simple/complex when on).
 */
export function useAgentModelsConfigured(): boolean {
  const { settings } = useSettings();
  return ["simple", "complex"].every((role) => {
    const a =
      settings.useSameModelForAgents ?
        settings.modelAssignments.chat
      : settings.modelAssignments[role];
    return !!a?.providerId && !!a?.modelId;
  });
}

/** Compact "models not configured" reminder with a Configure shortcut. */
export const ModelsNotConfiguredBanner: FC = () => {
  const { t } = useTranslation("common");
  const setActiveSettingsSection = useUiStore(
    (s) => s.setActiveSettingsSection,
  );
  const setShowSettings = useUiStore((s) => s.setShowSettings);

  return (
    <div
      className="flex items-center gap-2 rounded-lg border border-chart-4/40 bg-chart-4/10 px-3 py-2"
      role="alert"
    >
      <DotMatrix state="warning" className="size-4 shrink-0" />
      <p className="min-w-0 flex-1 text-xs text-muted-foreground">
        {t("capability.notConfigured.body")}
      </p>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => {
          setActiveSettingsSection("providers");
          setShowSettings(true);
        }}
        className="h-7 shrink-0 gap-1.5 px-2.5 text-xs"
      >
        <Settings2 className="size-3.5" />
        {t("capability.configure")}
      </Button>
    </div>
  );
};
