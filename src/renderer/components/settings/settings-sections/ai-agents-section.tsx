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
import type { SettingsState, SearchEngine, TimeoutsConfig } from "@shared";

interface AiAgentsSectionProps {
  settings: SettingsState;
}

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
    if (isNaN(num) || num < 1 || num > 10) return;
    await updateSettings({
      ...settings,
      maxParallelAgents: num,
    });
  };

  const handleRetryChange = async (value: string) => {
    const num = parseInt(value, 10);
    if (isNaN(num) || num < 0 || num > 10) return;
    await updateSettings({
      ...settings,
      maxRetries: num,
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

  const handleTimeoutChange = async (
    field: keyof TimeoutsConfig,
    value: string,
  ) => {
    const num = parseInt(value, 10);
    if (isNaN(num) || num < 30 || num > 3600) return;
    await updateSettings({
      ...settings,
      timeouts: {
        ...settings.timeouts,
        [field]: num,
      },
    });
  };

  const TIMEOUT_FIELDS: {
    field: keyof TimeoutsConfig;
    labelKey: string;
    tooltipKey: string;
    unitKey: string;
  }[] = [
    {
      field: "response",
      labelKey: "aiAgents.timeouts.response.label",
      tooltipKey: "aiAgents.timeouts.response.tooltip",
      unitKey: "aiAgents.timeouts.unit",
    },
    {
      field: "action",
      labelKey: "aiAgents.timeouts.action.label",
      tooltipKey: "aiAgents.timeouts.action.tooltip",
      unitKey: "aiAgents.timeouts.unit",
    },
    {
      field: "interactive",
      labelKey: "aiAgents.timeouts.interactive.label",
      tooltipKey: "aiAgents.timeouts.interactive.tooltip",
      unitKey: "aiAgents.timeouts.unit",
    },
    {
      field: "streaming",
      labelKey: "aiAgents.timeouts.streaming.label",
      tooltipKey: "aiAgents.timeouts.streaming.tooltip",
      unitKey: "aiAgents.timeouts.unit",
    },
  ];

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
            <Input
              id="max-parallel-agents"
              type="number"
              min={1}
              max={10}
              className="w-32"
              value={settings.maxParallelAgents}
              onChange={(e) => handleConcurrencyChange(e.target.value)}
            />
            <p className="text-sm text-muted-foreground">
              {t("aiAgents.concurrency.hint")}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("aiAgents.retries.title")}</CardTitle>
          <CardDescription>
            {t("aiAgents.retries.description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="max-retries">
                {t("aiAgents.retries.label")}
              </Label>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <CircleHelp className="h-4 w-4 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    {t("aiAgents.retries.tooltip")}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <Input
              id="max-retries"
              type="number"
              min={0}
              max={10}
              className="w-32"
              value={settings.maxRetries}
              onChange={(e) => handleRetryChange(e.target.value)}
            />
            <p className="text-sm text-muted-foreground">
              {t("aiAgents.retries.hint")}
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

      <Card>
        <CardHeader>
          <CardTitle>{t("aiAgents.timeouts.title")}</CardTitle>
          <CardDescription>
            {t("aiAgents.timeouts.description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {TIMEOUT_FIELDS.map(({ field, labelKey, tooltipKey, unitKey }) => (
              <div key={field} className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor={`timeout-${field}`}>
                    {t(labelKey)}
                  </Label>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <CircleHelp className="h-4 w-4 text-muted-foreground" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        {t(tooltipKey)}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    id={`timeout-${field}`}
                    type="number"
                    min={30}
                    max={3600}
                    className="w-32"
                    value={settings.timeouts?.[field] ?? ""}
                    onChange={(e) =>
                      handleTimeoutChange(field, e.target.value)
                    }
                  />
                  <span className="text-sm text-muted-foreground">
                    {t(unitKey)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
