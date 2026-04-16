import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
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
import type { ModelDefinition } from "@shared";

interface TomlModelListProps {
  providerDir: string;
  selectedModel: string;
  onModelSelect: (modelFile: string) => void;
}

export function TomlModelList({
  providerDir,
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
          m.name.toLowerCase().includes(filter.toLowerCase()) ||
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
      </div>
    );
  }

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
