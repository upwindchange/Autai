import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Check, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useProviderModels } from "@/hooks/useProviderModels";

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

  const filtered = filter
    ? models.filter((m) =>
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

      <ScrollArea className="max-h-48 rounded-md border">
        <div className="p-1">
          {filtered.map((model) => (
            <button
              key={model.file}
              onClick={() => onModelSelect(model.file)}
              className={cn(
                "flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-sm hover:bg-accent transition-colors",
                selectedModel === model.file && "bg-accent",
              )}
            >
              <div className="min-w-0">
                <span className="truncate">{model.name}</span>
                {model.limit && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    {formatContext(model.limit.context)}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0 ml-2">
                {model.cost && (
                  <span className="text-xs text-muted-foreground">
                    ${model.cost.input}/${model.cost.output}
                  </span>
                )}
                <Check
                  className={cn(
                    "h-4 w-4",
                    selectedModel === model.file ?
                      "opacity-100"
                    : "opacity-0",
                  )}
                />
              </div>
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="px-2 py-4 text-center text-sm text-muted-foreground">
              {t("modelList.noMatch", { filter })}
            </div>
          )}
        </div>
      </ScrollArea>

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

function formatContext(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(0)}K`;
  return `${tokens}`;
}
