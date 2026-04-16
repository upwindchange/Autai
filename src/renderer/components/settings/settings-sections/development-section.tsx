import { useState, useEffect } from "react";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Trash2, FolderOpen, ExternalLink, Database } from "lucide-react";
import { useSettings } from "@/components/settings";
import { useTranslation } from "react-i18next";
import type { SettingsState, LogLevel, LangfuseConfig } from "@shared";
import log from "electron-log/renderer";

const API_BASE = "http://localhost:3001";

const logger = log.scope("DevelopmentSection");

interface DevelopmentSectionProps {
  settings: SettingsState;
}

export function DevelopmentSection({ settings }: DevelopmentSectionProps) {
  const { updateSettings } = useSettings();
  const { t } = useTranslation("development");
  const [logLevel, setLogLevel] = useState<LogLevel>(
    settings?.logLevel || "info",
  );
  const [logPath, setLogPath] = useState<string>("");
  const [langfuseConfig, setLangfuseConfig] = useState<LangfuseConfig>({
    enabled: settings?.langfuse?.enabled || false,
    publicKey: settings?.langfuse?.publicKey || "",
    secretKey: settings?.langfuse?.secretKey || "",
    host: settings?.langfuse?.host || "",
  });

  useEffect(() => {
    if (settings?.logLevel) {
      setLogLevel(settings.logLevel);
    }
    if (settings?.langfuse) {
      setLangfuseConfig(settings.langfuse);
    }
  }, [settings]);

  useEffect(() => {
    // Get log file path
    fetch(`${API_BASE}/settings/log-path`)
      .then((res) => res.json())
      .then((data: { path: string }) => {
        setLogPath(data.path);
      })
      .catch((error: unknown) => {
        logger.error("Failed to get log path", error);
      });
  }, []);

  const handleLogLevelChange = async (value: string) => {
    const level = value as LogLevel;
    setLogLevel(level);
    const newSettings: SettingsState = {
      ...settings,
      logLevel: level,
    };
    await updateSettings(newSettings);
  };

  const handleClearLogs = async () => {
    try {
      await fetch(`${API_BASE}/settings/clear-logs`, { method: "POST" });
      logger.info("Logs cleared successfully");
    } catch (error) {
      logger.error("Failed to clear logs", error);
    }
  };

  const handleOpenLogFolder = async () => {
    try {
      await fetch(`${API_BASE}/settings/open-log-folder`, { method: "POST" });
    } catch (error) {
      logger.error("Failed to open log folder", error);
    }
  };

  const handleLangfuseToggle = async (enabled: boolean) => {
    const newConfig = { ...langfuseConfig, enabled };
    setLangfuseConfig(newConfig);
    const newSettings: SettingsState = {
      ...settings,
      langfuse: newConfig,
    };
    await updateSettings(newSettings);
  };

  const handleLangfuseConfigChange = async (
    key: keyof LangfuseConfig,
    value: string,
  ) => {
    const newConfig = { ...langfuseConfig, [key]: value };
    setLangfuseConfig(newConfig);
    const newSettings: SettingsState = {
      ...settings,
      langfuse: newConfig,
    };
    await updateSettings(newSettings);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">{t("title")}</h2>
        <p className="text-muted-foreground mt-1">{t("subtitle")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("logging.title")}</CardTitle>
          <CardDescription>{t("logging.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="log-level">{t("logging.level.label")}</Label>
            <Select value={logLevel} onValueChange={handleLogLevelChange}>
              <SelectTrigger id="log-level">
                <SelectValue placeholder={t("logging.level.placeholder")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="error">
                  {t("logging.level.error")}
                </SelectItem>
                <SelectItem value="warn">{t("logging.level.warn")}</SelectItem>
                <SelectItem value="info">{t("logging.level.info")}</SelectItem>
                <SelectItem value="verbose">
                  {t("logging.level.verbose")}
                </SelectItem>
                <SelectItem value="debug">
                  {t("logging.level.debug")}
                </SelectItem>
                <SelectItem value="silly">
                  {t("logging.level.silly")}
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">
              {t("logging.level.hint")}
            </p>
          </div>

          <Separator />

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t("logging.location.label")}</Label>
              <div className="flex items-center gap-2">
                <code className="flex-1 px-3 py-2 bg-muted rounded-md text-xs font-mono truncate">
                  {logPath || t("common:btn.loading")}
                </code>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleOpenLogFolder}
                  title={t("logging.location.openFolder")}
                >
                  <FolderOpen className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={handleClearLogs}
                className="gap-2"
              >
                <Trash2 className="h-4 w-4" />
                {t("logging.clearLogs")}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("debug.title")}</CardTitle>
          <CardDescription>{t("debug.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>{t("debug.devtools.label")}</Label>
              <p className="text-sm text-muted-foreground">
                {t("debug.devtools.hint")}
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => {
                fetch(`${API_BASE}/settings/open-devtools`, { method: "POST" });
              }}
            >
              {t("debug.devtools.open")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("database.title")}</CardTitle>
          <CardDescription>{t("database.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>{t("database.purgeThreads.label")}</Label>
              <p className="text-sm text-muted-foreground">
                {t("database.purgeThreads.hint")}
              </p>
            </div>
            <Button
              variant="outline"
              className="gap-2 text-destructive hover:text-destructive"
              onClick={() => {
                if (confirm(t("database.purgeThreads.confirm"))) {
                  fetch(`${API_BASE}/settings/purge-thread-tables`, {
                    method: "POST",
                  });
                }
              }}
            >
              <Trash2 className="h-4 w-4" />
              {t("database.purgeThreads.button")}
            </Button>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>{t("database.purgeSettings.label")}</Label>
              <p className="text-sm text-muted-foreground">
                {t("database.purgeSettings.hint")}
              </p>
            </div>
            <Button
              variant="outline"
              className="gap-2 text-destructive hover:text-destructive"
              onClick={() => {
                if (confirm(t("database.purgeSettings.confirm"))) {
                  fetch(`${API_BASE}/settings/purge-settings-tables`, {
                    method: "POST",
                  });
                }
              }}
            >
              <Database className="h-4 w-4" />
              {t("database.purgeSettings.button")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("langfuse.title")}</CardTitle>
          <CardDescription>{t("langfuse.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="langfuse-enabled">
                {t("langfuse.enabled.label")}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t("langfuse.enabled.hint")}
              </p>
            </div>
            <Switch
              id="langfuse-enabled"
              checked={langfuseConfig.enabled}
              onCheckedChange={handleLangfuseToggle}
            />
          </div>

          {langfuseConfig.enabled && (
            <>
              <Separator />

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="langfuse-public-key">
                    {t("langfuse.publicKey.label")}
                  </Label>
                  <Input
                    id="langfuse-public-key"
                    type="text"
                    placeholder="pk-lf-..."
                    value={langfuseConfig.publicKey || ""}
                    onChange={(e) =>
                      handleLangfuseConfigChange("publicKey", e.target.value)
                    }
                  />
                  <p className="text-sm text-muted-foreground">
                    {t("langfuse.publicKey.hint")}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="langfuse-secret-key">
                    {t("langfuse.secretKey.label")}
                  </Label>
                  <Input
                    id="langfuse-secret-key"
                    type="password"
                    placeholder="sk-lf-..."
                    value={langfuseConfig.secretKey || ""}
                    onChange={(e) =>
                      handleLangfuseConfigChange("secretKey", e.target.value)
                    }
                  />
                  <p className="text-sm text-muted-foreground">
                    {t("langfuse.secretKey.hint")}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="langfuse-host">
                    {t("langfuse.host.label")}
                  </Label>
                  <Input
                    id="langfuse-host"
                    type="url"
                    placeholder="https://cloud.langfuse.com (default)"
                    value={langfuseConfig.host || ""}
                    onChange={(e) =>
                      handleLangfuseConfigChange("host", e.target.value)
                    }
                  />
                  <p className="text-sm text-muted-foreground">
                    {t("langfuse.host.hint")}
                  </p>
                </div>

                <div className="pt-2">
                  <Button
                    variant="outline"
                    className="gap-2"
                    onClick={() =>
                      window.open(
                        langfuseConfig.host || "https://cloud.langfuse.com",
                        "_blank",
                      )
                    }
                  >
                    <ExternalLink className="h-4 w-4" />
                    {t("langfuse.openDashboard")}
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
