import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Label } from "@/components/ui/label";
import { RefreshCw, Check, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { ProviderConfig } from "@shared";
import log from "electron-log/renderer";

const logger = log.scope("ModelList");

interface OpenAIModel {
  id: string;
  object: string;
  created?: number;
  owned_by?: string;
}

interface ModelListProps {
  provider: ProviderConfig;
  selectedModel: string;
  onModelSelect: (modelName: string) => void;
}

// Common Anthropic model suggestions
const ANTHROPIC_MODEL_SUGGESTIONS = [
  "claude-sonnet-4-20250514",
  "claude-opus-4-20250514",
  "claude-3-7-sonnet-20250219",
  "claude-3-5-sonnet-20241022",
  "claude-3-5-haiku-20241022",
  "claude-3-opus-20240229",
];

export function ModelList({
  provider,
  selectedModel,
  onModelSelect,
}: ModelListProps) {
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const { t } = useTranslation("providers");

  const providerType = provider.provider;

  useEffect(() => {
    if (providerType === "openai-compatible" || providerType === "deepinfra") {
      fetchModels();
    }
  }, [provider.id]);

  const fetchModels = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${provider.apiUrl}/models`, {
        headers: {
          Authorization: `Bearer ${provider.apiKey}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const models = (data.data as OpenAIModel[])
        .filter((model) => model.id)
        .map((model) => model.id)
        .sort();

      setAvailableModels(models);
    } catch (error) {
      logger.error("failed to fetch models", error);
      setAvailableModels([]);
    } finally {
      setIsLoading(false);
    }
  };

  // Anthropic: simple text input with suggestions
  if (providerType === "anthropic") {
    return (
      <div className="space-y-2">
        <Label>{t("modelList.modelName")}</Label>
        <Input
          value={selectedModel}
          onChange={(e) => onModelSelect(e.target.value)}
          placeholder="e.g., claude-sonnet-4-20250514"
        />
        <div className="flex flex-wrap gap-1.5">
          {ANTHROPIC_MODEL_SUGGESTIONS.map((suggestion) => (
            <Button
              key={suggestion}
              variant={selectedModel === suggestion ? "default" : "outline"}
              size="sm"
              className="h-6 text-xs"
              onClick={() => onModelSelect(suggestion)}
            >
              {suggestion}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {t("modelList.suggestion.hint")}
        </p>
      </div>
    );
  }

  // OpenAI-compatible / DeepInfra: browsable list with filter
  const filteredModels =
    filter ?
      availableModels.filter((m) =>
        m.toLowerCase().includes(filter.toLowerCase()),
      )
    : availableModels;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>{t("modelList.available")}</Label>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchModels}
          disabled={isLoading}
        >
          <RefreshCw
            className={cn("h-3.5 w-3.5 mr-1.5", isLoading && "animate-spin")}
          />
          {t("modelList.refresh")}
        </Button>
      </div>

      {availableModels.length > 0 ?
        <>
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
              {filteredModels.map((model) => (
                <button
                  key={model}
                  onClick={() => onModelSelect(model)}
                  className={cn(
                    "flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-sm hover:bg-accent transition-colors",
                    selectedModel === model && "bg-accent",
                  )}
                >
                  <span className="truncate">{model}</span>
                  <Check
                    className={cn(
                      "h-4 w-4 shrink-0 ml-2",
                      selectedModel === model ? "opacity-100" : "opacity-0",
                    )}
                  />
                </button>
              ))}
              {filteredModels.length === 0 && (
                <div className="px-2 py-4 text-center text-sm text-muted-foreground">
                  {t("modelList.noMatch", { filter })}
                </div>
              )}
            </div>
          </ScrollArea>
        </>
      : <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
          {isLoading ?
            t("modelList.loading")
          : t("modelList.empty")}
        </div>
      }

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">
          {t("modelList.manual")}
        </Label>
        <Input
          value={selectedModel}
          onChange={(e) => onModelSelect(e.target.value)}
          placeholder="e.g., gpt-4o"
        />
      </div>
    </div>
  );
}
