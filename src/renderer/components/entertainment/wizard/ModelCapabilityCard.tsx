import { type FC } from "react";
import { useTranslation } from "react-i18next";
import {
  Cpu,
  Feather,
  Gauge,
  Info,
  Layers,
  Settings2,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DotMatrix } from "@/components/assistant-ui/dot-matrix";
import { useSettings } from "@/components/settings";
import { useConfiguredModels } from "@/hooks/useConfiguredModels";
import { useUiStore } from "@/stores/uiStore";
import type { ModelRole } from "@shared";

/**
 * Entertainment wizard — shows the two models the dehydrate pipeline uses
 * (complex for outlining + rewriting, simple for outline compression) with
 * their provider and context window, explains how context size and model
 * capability affect agent performance, and links into Settings → Providers &
 * Models for reconfiguration.
 *
 * Resolution mirrors the backend: when useSameModelForAgents is on, the simple
 * and complex roles both mirror the chat assignment. Context window comes from
 * the catalog `limit.context` (TOML providers) or a manual override
 * (openai-compatible), unified through GET /providers/configured/models.
 *
 * When no models are configured at all, the whole card collapses into a single
 * warning state (DotMatrix error glyph) prompting the user to configure models
 * before starting — a dehydrate run will fail without them.
 */

/** Default context shown when a model has no known limit (openai-compatible w/o override). */
const DEFAULT_CONTEXT_WINDOW = 128_000;

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(0)}K`;
  return `${tokens}`;
}

export const ModelCapabilityCard: FC = () => {
  const { t } = useTranslation("entertainment");
  const { settings } = useSettings();
  const { models } = useConfiguredModels();
  const setActiveSettingsSection = useUiStore(
    (s) => s.setActiveSettingsSection,
  );
  const setShowSettings = useUiStore((s) => s.setShowSettings);

  // Effective role assignment honors useSameModelForAgents (simple/complex
  // mirror chat when on) — same rule as the backend factory.
  const effective = (role: ModelRole) =>
    settings.useSameModelForAgents && role !== "chat" ?
      settings.modelAssignments.chat
    : settings.modelAssignments[role];

  const resolve = (role: ModelRole) => {
    const a = effective(role);
    if (!a?.providerId || !a?.modelId) return null;
    const m = models.find(
      (x) => x.providerId === a.providerId && x.modelId === a.modelId,
    );
    return {
      providerId: a.providerId,
      modelId: a.modelId,
      providerName: m?.providerName ?? a.providerId,
      modelName: m?.modelName ?? a.modelId,
      logo: m?.logo,
      contextWindow: m?.limit?.context ?? DEFAULT_CONTEXT_WINDOW,
      hasKnownLimit: !!m?.limit?.context,
    };
  };

  const complex = resolve("complex");
  const simple = resolve("simple");

  const openProvidersSettings = () => {
    setActiveSettingsSection("providers");
    setShowSettings(true);
  };

  // No models configured at all — collapse into a single warning that blocks
  // a meaningful dehydrate run.
  if (!complex && !simple) {
    return (
      <section
        className="fade-in slide-in-from-bottom-1 animate-in fill-mode-both mx-auto flex w-full max-w-4xl items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 duration-200"
        role="alert"
      >
        <DotMatrix state="warning" className="size-5 shrink-0" />
        <div className="flex-1">
          <p className="text-sm font-medium text-amber-700 dark:text-amber-500">
            {t("capability.notConfigured.title")}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("capability.notConfigured.body")}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={openProvidersSettings}
          className="shrink-0"
        >
          <Settings2 className="mr-1.5 size-3.5" />
          {t("capability.configure")}
        </Button>
      </section>
    );
  }

  return (
    <section
      className="fade-in slide-in-from-bottom-1 animate-in fill-mode-both mx-auto w-full max-w-4xl rounded-lg border bg-card p-4 duration-200"
      aria-label={t("capability.title")}
    >
      <div className="mb-3 flex items-center gap-2">
        <Layers className="size-4 text-primary" />
        <h3 className="text-sm font-semibold">{t("capability.title")}</h3>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ModelColumn
          icon={<Cpu className="size-3.5" />}
          label={t("capability.complex.role")}
          sublabel={t("capability.complex.task")}
          model={complex}
          t={t}
        />
        <ModelColumn
          icon={<Feather className="size-3.5" />}
          label={t("capability.simple.role")}
          sublabel={t("capability.simple.task")}
          model={simple}
          hint={t("capability.simple.hint")}
          t={t}
        />
      </div>

      <div className="mt-3 flex gap-2 rounded-md bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
        <Info className="size-3.5 shrink-0 translate-y-0.5 text-muted-foreground/70" />
        <div>
          <p>{t("capability.explain.context")}</p>
          <p className="mt-1">{t("capability.explain.capability")}</p>
        </div>
      </div>

      <div className="mt-3 flex justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={openProvidersSettings}
        >
          <Settings2 className="mr-1.5 size-3.5" />
          {t("capability.configure")}
        </Button>
      </div>
    </section>
  );
};

type TFunc = ReturnType<typeof useTranslation>["t"];

type ResolvedModelInfo = {
  providerId: string;
  modelId: string;
  providerName: string;
  modelName: string;
  logo?: string;
  contextWindow: number;
  hasKnownLimit: boolean;
} | null;

const ModelColumn: FC<{
  icon: React.ReactNode;
  label: string;
  sublabel: string;
  model: ResolvedModelInfo;
  hint?: string;
  t: TFunc;
}> = ({ icon, label, sublabel, model, hint, t }) => {
  return (
    <div className="flex flex-col gap-1.5 rounded-md border bg-background/40 p-3">
      <div>
        <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {icon}
          {label}
        </div>
        <div className="text-[11px] text-muted-foreground/80">{sublabel}</div>
      </div>
      {model ? (
        <>
          <div className="flex items-center gap-2">
            {model.logo && (
              <span
                className="size-4 shrink-0 [&_svg]:h-full [&_svg]:w-full"
                dangerouslySetInnerHTML={{ __html: model.logo }}
              />
            )}
            <span className="truncate text-sm font-medium">
              {model.modelName}
            </span>
          </div>
          <div className="text-[11px] text-muted-foreground">
            {model.providerName}
          </div>
          <div className="mt-0.5 flex items-baseline gap-1">
            <Gauge className="size-3.5 shrink-0 translate-y-0.5 text-muted-foreground/70" />
            <span className="font-mono text-lg font-semibold tabular-nums">
              {formatTokens(model.contextWindow)}
            </span>
            <span className="text-xs font-normal text-muted-foreground">
              {t("capability.tokens")}
            </span>
          </div>
          {!model.hasKnownLimit && (
            <div className="flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-500">
              <TriangleAlert className="size-3 shrink-0" />
              {t("capability.defaultBadge")}
            </div>
          )}
          {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
        </>
      ) : (
        <div className="flex items-center gap-2 py-1">
          <DotMatrix state="warning" className="size-4 shrink-0" />
          <p className="text-xs text-amber-600 dark:text-amber-500">
            {t("capability.notConfigured.body")}
          </p>
        </div>
      )}
    </div>
  );
};
