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
import type { SettingsState } from "@shared";

interface AiAgentsSectionProps {
  settings: SettingsState;
}

const CONCURRENCY_OPTIONS = [1, 2, 3, 4, 5, 6, 8, 10];

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

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">{t("aiAgents.title")}</h2>
        <p className="text-muted-foreground mt-1">
          {t("aiAgents.subtitle")}
        </p>
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
    </div>
  );
}
