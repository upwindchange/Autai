import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CircleHelp } from "lucide-react";
import { useSettings } from "@/components/settings";
import { useTranslation } from "react-i18next";
import type { SettingsState, SearchEngine } from "@shared";

interface AiAgentsSectionProps {
  settings: SettingsState;
}

const CONCURRENCY_OPTIONS = [1, 2, 3, 4, 5, 6, 8, 10];

const SEARCH_ENGINE_OPTIONS: {
  value: SearchEngine;
  label: string;
}[] = [
  { value: "google", label: "Google" },
  { value: "bing", label: "Bing" },
  { value: "bingChina", label: "必应 (Bing China)" },
  { value: "duckduckgo", label: "DuckDuckGo" },
  { value: "brave", label: "Brave Search" },
  { value: "baidu", label: "百度 (Baidu)" },
  { value: "sogou", label: "搜狗 (Sogou)" },
  { value: "custom", label: "Custom" },
];

export function AiAgentsSection({ settings }: AiAgentsSectionProps) {
  const { updateSettings } = useSettings();
  const { t } = useTranslation("settings");

  const handleConcurrencyChange = async (value: string) => {
    const num = parseInt(value, 10);
    await updateSettings({
      ...settings,
      maxParallelAgents: num,
    });
  };

  const handleSearchEngineChange = async (value: string) => {
    await updateSettings({
      ...settings,
      searchEngine: value as SearchEngine,
    });
  };

  const handleCustomNameChange = async (name: string) => {
    await updateSettings({
      ...settings,
      searchEngine: "custom",
      customSearchEngine: {
        name,
        urlTemplate: settings.customSearchEngine?.urlTemplate ?? "",
      },
    });
  };

  const handleCustomUrlChange = async (urlTemplate: string) => {
    await updateSettings({
      ...settings,
      searchEngine: "custom",
      customSearchEngine: {
        name: settings.customSearchEngine?.name ?? "",
        urlTemplate,
      },
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">{t("aiAgents.title")}</h2>
        <p className="text-muted-foreground mt-1">{t("aiAgents.subtitle")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("aiAgents.concurrency.title")}</CardTitle>
          <CardDescription>
            {t("aiAgents.concurrency.description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="max-parallel-agents">
                {t("aiAgents.concurrency.label")}
              </Label>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <CircleHelp className="h-4 w-4 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    {t("aiAgents.concurrency.tooltip")}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <Select
              value={String(settings.maxParallelAgents)}
              onValueChange={handleConcurrencyChange}
            >
              <SelectTrigger id="max-parallel-agents" className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONCURRENCY_OPTIONS.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">
              {t("aiAgents.concurrency.hint")}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("aiAgents.searchEngine.title")}</CardTitle>
          <CardDescription>
            {t("aiAgents.searchEngine.description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="search-engine">
                {t("aiAgents.searchEngine.label")}
              </Label>
              <Select
                value={settings.searchEngine}
                onValueChange={handleSearchEngineChange}
              >
                <SelectTrigger id="search-engine" className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEARCH_ENGINE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-sm text-muted-foreground">
                {t("aiAgents.searchEngine.hint")}
              </p>
            </div>

            {settings.searchEngine === "custom" && (
              <div className="space-y-3 rounded-md border p-4">
                <div className="space-y-2">
                  <Label htmlFor="custom-engine-name">
                    {t("aiAgents.searchEngine.custom.name")}
                  </Label>
                  <Input
                    id="custom-engine-name"
                    className="w-80"
                    placeholder={t(
                      "aiAgents.searchEngine.custom.name.placeholder",
                    )}
                    value={settings.customSearchEngine?.name ?? ""}
                    onChange={(e) => handleCustomNameChange(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="custom-engine-url">
                    {t("aiAgents.searchEngine.custom.url")}
                  </Label>
                  <Input
                    id="custom-engine-url"
                    className="w-80"
                    placeholder={t(
                      "aiAgents.searchEngine.custom.url.placeholder",
                    )}
                    value={settings.customSearchEngine?.urlTemplate ?? ""}
                    onChange={(e) => handleCustomUrlChange(e.target.value)}
                  />
                  <p className="text-sm text-muted-foreground">
                    {t("aiAgents.searchEngine.custom.url.hint")}
                  </p>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
