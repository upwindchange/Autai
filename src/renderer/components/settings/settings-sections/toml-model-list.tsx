import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Check,
  Search,
  Eye,
  FileText,
  Brain,
  Wrench,
  Coins,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useProviderModels } from "@/hooks/useProviderModels";
import { useSettings } from "@/components/settings";
import type { ModelDefinition, ModelOverride } from "@shared";

interface TomlModelListProps {
  providerDir: string;
  /**
   * The userProviders.id for the provider being configured. Required for the
   * manual-capability override inputs shown when a model has no TOML `limit`
   * (the openai-compatible case). Omitted => override editing is unavailable.
   */
  providerId?: string;
  selectedModel: string;
  onModelSelect: (modelFile: string) => void;
}

export function TomlModelList({
  providerDir,
  providerId,
  selectedModel,
  onModelSelect,
}: TomlModelListProps) {
  const { models, loading, error } = useProviderModels(providerDir);
  const [filter, setFilter] = useState("");
  const { t } = useTranslation("providers");

  const filtered =
    filter ?
      models.filter(
        (m) =>
          m.name?.toLowerCase().includes(filter.toLowerCase()) ||
          m.file.toLowerCase().includes(filter.toLowerCase()) ||
          (m.family && m.family.toLowerCase().includes(filter.toLowerCase())),
      )
    : models;

  if (loading) {
    return (
      <div className="space-y-2">
        <Label>{t("modelList.available")}</Label>
        <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
          {t("modelList.loading")}
        </div>
      </div>
    );
  }

  if (error || models.length === 0) {
    return (
      <div className="space-y-2">
        <Label>{t("modelList.modelName")}</Label>
        <Input
          value={selectedModel}
          onChange={(e) => onModelSelect(e.target.value)}
          placeholder="e.g., claude-sonnet-4-6"
        />
        {(error || models.length === 0) && (
          <p className="text-xs text-muted-foreground">
            {t("modelList.empty")}
          </p>
        )}
        {/* For the no-TOML (openai-compatible) case, surface the override
            inputs even when the model list is empty — the user types a model
            id manually above and may still need to declare its caps. */}
        {providerId && selectedModel && (
          <ModelOverrideInputs
            providerId={providerId}
            modelId={selectedModel}
          />
        )}
      </div>
    );
  }

  // The selected model, if it has no catalog `limit`, gets editable override
  // inputs below the list (openai-compatible models fetched from /models).
  const selected = models.find((m) => m.file === selectedModel);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>{t("modelList.available")}</Label>
        <span className="text-xs text-muted-foreground">
          {models.length} {t("modelList.count")}
        </span>
      </div>

      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t("modelList.filter.placeholder")}
          className="pl-9"
        />
      </div>

      <div className="max-h-64 overflow-y-auto rounded-md border">
        {filtered.map((model) => (
          <button
            key={model.file}
            onClick={() => onModelSelect(model.file)}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent transition-colors border-b last:border-b-0",
              selectedModel === model.file && "bg-accent",
            )}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-medium truncate">
                  {model.name}
                </span>
                {selectedModel === model.file && (
                  <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                )}
              </div>
              <ModelBadges model={model} />
            </div>
            <ModelMetrics model={model} />
          </button>
        ))}
        {filtered.length === 0 && (
          <div className="px-3 py-4 text-center text-sm text-muted-foreground">
            {t("modelList.noMatch", { filter })}
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">
          {t("modelList.manual")}
        </Label>
        <Input
          value={selectedModel}
          onChange={(e) => onModelSelect(e.target.value)}
          placeholder="e.g., claude-sonnet-4-6"
        />
      </div>

      {/* Manual capability override for a model with no catalog limit. The
          frontend owns the 128k default — the user is told to enter a value,
          and what reaches the backend is always a concrete number. */}
      {providerId && selectedModel && selected && !selected.limit && (
        <ModelOverrideInputs providerId={providerId} modelId={selectedModel} />
      )}
    </div>
  );
}

/**
 * Editable context-window / max-output inputs for a model whose catalog has no
 * `limit` (openai-compatible). Persists into settings.modelOverrides keyed by
 * (providerId, modelId). The hint states the 128k default so the user knows
 * what happens if they leave a field blank — the frontend default that keeps
 * the backend from ever seeing "no value" for an openai-compatible model.
 */
function ModelOverrideInputs({
  providerId,
  modelId,
}: {
  providerId: string;
  modelId: string;
}) {
  const { t } = useTranslation("providers");
  const { settings, updateSettings } = useSettings();

  const existing = settings.modelOverrides.find(
    (o) => o.providerId === providerId && o.modelId === modelId,
  );

  const writeOverride = (patch: Partial<ModelOverride>) => {
    const base: ModelOverride = existing ?? {
      providerId,
      modelId,
    };
    const next: ModelOverride = { ...base, ...patch };
    // Drop the entry entirely if both fields are cleared.
    const others = settings.modelOverrides.filter(
      (o) => !(o.providerId === providerId && o.modelId === modelId),
    );
    const merged =
      next.contextWindow || next.maxOutputTokens ? [...others, next] : others;
    void updateSettings({ ...settings, modelOverrides: merged });
  };

  return (
    <div className="space-y-1.5 rounded-md border border-dashed p-3">
      <Label className="text-xs font-medium">
        {t("modelList.override.title")}
      </Label>
      <p className="text-[11px] text-muted-foreground">
        {t("modelList.override.hint")}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">
            {t("modelList.override.context")}
          </Label>
          <Input
            type="number"
            min={1}
            inputMode="numeric"
            value={existing?.contextWindow ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              writeOverride({
                contextWindow: v ? Number(v) : undefined,
              });
            }}
            placeholder="128000"
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">
            {t("modelList.override.output")}
          </Label>
          <Input
            type="number"
            min={1}
            inputMode="numeric"
            value={existing?.maxOutputTokens ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              writeOverride({
                maxOutputTokens: v ? Number(v) : undefined,
              });
            }}
            placeholder="—"
            className="h-8 text-xs"
          />
        </div>
      </div>
    </div>
  );
}

// Capability icons for model features
function ModelBadges({ model }: { model: ModelDefinition }) {
  const icons: React.ReactNode[] = [];

  // Vision (image input)
  if (model.modalities?.input?.includes("image")) {
    icons.push(<Eye key="vision" className="h-3 w-3 text-blue-500" />);
  }
  // PDF support
  if (model.modalities?.input?.includes("pdf")) {
    icons.push(<FileText key="pdf" className="h-3 w-3 text-orange-500" />);
  }
  // Reasoning / thinking
  if (model.reasoning) {
    icons.push(<Brain key="reasoning" className="h-3 w-3 text-purple-500" />);
  }
  // Tool calling
  if (model.toolCall) {
    icons.push(<Wrench key="tool" className="h-3 w-3 text-green-500" />);
  }

  if (icons.length === 0) return null;

  return <div className="flex items-center gap-1 mt-0.5">{icons}</div>;
}

// Context/output length and cost
function ModelMetrics({ model }: { model: ModelDefinition }) {
  return (
    <div className="flex flex-col items-end shrink-0 gap-0.5">
      {model.limit && (
        <span className="text-[11px] text-muted-foreground whitespace-nowrap">
          {formatTokens(model.limit.context)} ctx /{" "}
          {formatTokens(model.limit.output)} out
        </span>
      )}
      {model.cost && (
        <span className="flex items-center gap-0.5 text-[11px] text-muted-foreground">
          <Coins className="h-2.5 w-2.5" />${model.cost.input}/$
          {model.cost.output}
        </span>
      )}
    </div>
  );
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(0)}K`;
  return `${tokens}`;
}
