import { type FC, type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  BookOpen,
  Cpu,
  Feather,
  Headphones,
  MessageSquare,
  Settings2,
} from "lucide-react";
import appIcon from "@/app-icon.png";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useSettings } from "@/components/settings";
import { useConfiguredModels } from "@/hooks/useConfiguredModels";
import { useUiStore } from "@/stores/uiStore";
import {
  ModelsNotConfiguredBanner,
  useAgentModelsConfigured,
} from "@/components/welcome/ModelSummary";
import type { ModelRole } from "@shared";

type WelcomeChoice = "chat" | "story";

type ModelChipInfo = {
  providerName: string;
  modelName: string;
  contextWindow: number;
};

/** Default context shown when a model has no known limit (openai-compatible w/o override). */
const DEFAULT_CONTEXT_WINDOW = 128_000;

// Token abbreviation thresholds/rounding/suffix are non-obvious inline.
function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(0)}K`;
  return `${tokens}`;
}

function ModelChip({ icon, model, label }: {
  icon: ReactNode;
  model: ModelChipInfo | null;
  label: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-full border bg-background/60 py-1 pl-2 pr-3">
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground [&_svg]:size-3.5">
        {icon}
      </span>
      <span className="truncate text-xs">
        <span className="font-medium">
          {model ? model.modelName : label}
        </span>
        {model && (
          <span className="text-muted-foreground">
            {" · "}
            {label}
            {" · "}
            {formatTokens(model.contextWindow)}
          </span>
        )}
      </span>
    </div>
  );
}

/**
 * Boot mode picker: full-bleed welcome screen shown instead of the normal
 * layout until the user picks Chat or Story. The mode cards carry the visual
 * weight; models appear only as a quiet info strip at the bottom.
 */
export const WelcomeScreen: FC = () => {
  const { t } = useTranslation("common");
  const { settings, isLoading, updateSettings } = useSettings();
  const { models } = useConfiguredModels();
  const modelsConfigured = useAgentModelsConfigured();
  const setAppMode = useUiStore((s) => s.setAppMode);
  const setWelcomeActive = useUiStore((s) => s.setWelcomeActive);
  const setActiveSettingsSection = useUiStore(
    (s) => s.setActiveSettingsSection,
  );
  const setShowSettings = useUiStore((s) => s.setShowSettings);
  const [dontShow, setDontShow] = useState(false);

  // Quiet role resolution — same effective rule as the backend factory.
  const effective = (role: ModelRole) =>
    settings.useSameModelForAgents && role !== "chat" ?
      settings.modelAssignments.chat
    : settings.modelAssignments[role];

  const chip = (role: ModelRole): ModelChipInfo | null => {
    const a = effective(role);
    if (!a?.providerId || !a?.modelId) return null;
    const m = models.find(
      (x) => x.providerId === a.providerId && x.modelId === a.modelId,
    );
    return {
      providerName: m?.providerName ?? a.providerId,
      modelName: m?.modelName ?? a.modelId,
      contextWindow: m?.limit?.context ?? DEFAULT_CONTEXT_WINDOW,
    };
  };

  // Blank while settings resolve — no flash of the chat layout underneath.
  if (isLoading) return null;

  // Entering a mode is one click — the card itself commits. Story runs the
  // dehydrate pipeline, which needs both agent models; the footer reminder
  // shows then. Chat is never blocked.
  const enter = (mode: WelcomeChoice) => {
    if (mode === "story" && !modelsConfigured) return;
    const appMode = mode === "chat" ? "chat" : "story";
    if (dontShow) {
      void updateSettings({
        ...settings,
        defaultAppMode: appMode,
        showWelcomeOnStartup: false,
      });
    }
    setAppMode(appMode);
    setWelcomeActive(false);
  };

  const openProvidersSettings = () => {
    setActiveSettingsSection("providers");
    setShowSettings(true);
  };

  const modes = [
    {
      value: "chat" as const,
      icon: MessageSquare,
      label: t("welcome.mode.chat.label"),
      description: t("welcome.mode.chat.description"),
      enabled: true,
    },
    {
      value: "story" as const,
      icon: BookOpen,
      label: t("welcome.mode.story.label"),
      description: t("welcome.mode.story.description"),
      enabled: true,
    },
    {
      value: "audiobook" as const,
      icon: Headphones,
      label: t("welcome.mode.audiobook.label"),
      description: t("welcome.mode.audiobook.description"),
      // Audiobook & Podcast isn't built yet — greyed-out and unselectable.
      enabled: false,
    },
  ];

  return (
    <div className="relative flex h-full w-full flex-col items-center overflow-y-auto">
      {/* Ambient backdrop — soft primary tint anchored behind the hero. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-gradient-to-b from-primary/10 via-primary/5 to-transparent"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[-220px] size-[480px] -translate-x-1/2 rounded-full bg-primary/20 blur-[120px]"
      />

      <main className="relative z-10 flex w-full max-w-6xl flex-1 flex-col items-center px-6 py-10 sm:py-14">
        {/* Hero */}
        <div className="fade-in slide-in-from-bottom-2 animate-in fill-mode-both duration-500 flex flex-col items-center gap-4 text-center">
          <img
            src={appIcon}
            alt="Autai"
            className="size-16 rounded-2xl shadow-lg shadow-primary/25"
          />
          <div className="space-y-3">
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              {t("welcome.title")}
            </h1>
            <p className="text-balance text-base text-muted-foreground">
              {t("welcome.subtitle")}
            </p>
          </div>
        </div>

        {/* Mode cards — the majority of the visual weight. One click enters. */}
        <div className="mt-10 grid w-full max-w-4xl gap-4 sm:mt-12 sm:grid-cols-3">
          {modes.map((mode, i) => (
            <button
              key={mode.value}
              type="button"
              disabled={!mode.enabled}
              onClick={() => {
                if (mode.value !== "audiobook") enter(mode.value);
              }}
              className={[
                "group relative flex h-full w-full flex-col gap-4 rounded-2xl border p-6 text-left transition-all duration-200",
                "fade-in slide-in-from-bottom-2 animate-in fill-mode-both",
                !mode.enabled ?
                  "cursor-not-allowed opacity-60"
                : "bg-card hover:border-primary/40 hover:bg-primary/5 hover:shadow-lg hover:shadow-primary/10 hover:ring-1 hover:ring-primary/30",
              ].join(" ")}
              style={{ animationDelay: `${(i + 1) * 100}ms` }}
            >
              <div className="flex items-start justify-between">
                <span className="grid size-12 place-items-center rounded-xl bg-muted text-muted-foreground transition-colors group-hover:bg-primary group-hover:text-primary-foreground group-hover:shadow-md group-hover:shadow-primary/25">
                  <mode.icon className="size-6" />
                </span>
                {!mode.enabled && (
                  <Badge variant="secondary" className="font-normal">
                    {t("welcome.comingSoon")}
                  </Badge>
                )}
              </div>
              <div className="space-y-1.5">
                <h2 className="text-lg font-semibold">{mode.label}</h2>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {mode.description}
                </p>
              </div>
            </button>
          ))}
        </div>

        {/* Don't-show-again */}
        <label
          htmlFor="welcome-dont-show"
          className="mt-8 flex cursor-pointer items-center gap-2 text-sm text-muted-foreground sm:mt-10"
        >
          <Checkbox
            id="welcome-dont-show"
            checked={dontShow}
            onCheckedChange={(c) => setDontShow(c === true)}
          />
          {t("welcome.dontShow")}
        </label>

        {/* Models — quiet info strip pinned to the bottom */}
        <footer className="mt-auto w-full max-w-4xl pt-12">
          <div className="flex flex-col gap-3 rounded-xl border bg-muted/30 p-4">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="mr-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t("capability.title")}
              </span>
              <ModelChip
                icon={<MessageSquare />}
                model={chip("chat")}
                label={t("capability.chat.role")}
              />
              <ModelChip
                icon={<Cpu />}
                model={chip("complex")}
                label={t("capability.complex.short")}
              />
              <ModelChip
                icon={<Feather />}
                model={chip("simple")}
                label={t("capability.simple.short")}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={openProvidersSettings}
                className="ml-auto h-7 gap-1.5 px-2.5 text-xs text-muted-foreground"
              >
                <Settings2 className="size-3.5" />
                {t("capability.configure")}
              </Button>
            </div>
            {!modelsConfigured && <ModelsNotConfiguredBanner />}
          </div>
        </footer>
      </main>
    </div>
  );
};
