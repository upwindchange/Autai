import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ExternalLink, FileText, Heart } from "lucide-react";
import { useTranslation } from "react-i18next";
import { GitHubIcon } from "@/components/assistant-ui/github";

export function AboutSection() {
  const { t } = useTranslation("about");
  const [appVersion, setAppVersion] = useState<string>(t("common:btn.loading"));
  const [platform, setPlatform] = useState<string>(t("common:btn.loading"));
  const [electronVersion, setElectronVersion] = useState<string>(
    t("common:btn.loading"),
  );
  const [nodeVersion, setNodeVersion] = useState<string>(
    t("common:btn.loading"),
  );

  useEffect(() => {
    // Get app version from main process
    window.ipcRenderer
      .invoke("app:getVersion")
      .then((version: unknown) => {
        setAppVersion(String(version));
      })
      .catch(() => {
        setAppVersion(t("common:value.unknown"));
      });

    // Get system info from main process
    window.ipcRenderer
      .invoke("app:getSystemInfo")
      .then((info: unknown) => {
        if (info && typeof info === "object") {
          const systemInfo = info as {
            platform: string;
            electronVersion: string;
            nodeVersion: string;
            chromeVersion?: string;
            v8Version?: string;
          };
          setPlatform(systemInfo.platform || t("common:value.unknown"));
          setElectronVersion(
            systemInfo.electronVersion || t("common:value.unknown"),
          );
          setNodeVersion(systemInfo.nodeVersion || t("common:value.unknown"));
        } else {
          setPlatform(t("common:value.unknown"));
          setElectronVersion(t("common:value.unknown"));
          setNodeVersion(t("common:value.unknown"));
        }
      })
      .catch(() => {
        setPlatform(t("common:value.unknown"));
        setElectronVersion(t("common:value.unknown"));
        setNodeVersion(t("common:value.unknown"));
      });
  }, [t]);

  const openExternal = (url: string) => {
    window.ipcRenderer.invoke("shell:openExternal", url);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">{t("title")}</h2>
        <p className="text-muted-foreground mt-1">{t("subtitle")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("info.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">
                {t("info.version")}
              </p>
              <p className="font-mono">{appVersion}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">
                {t("info.platform")}
              </p>
              <p className="font-mono">{platform}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">
                {t("info.electron")}
              </p>
              <p className="font-mono">{electronVersion}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">
                {t("info.nodejs")}
              </p>
              <p className="font-mono">{nodeVersion}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("resources.title")}</CardTitle>
          <CardDescription>{t("resources.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button
            variant="outline"
            className="w-full justify-start gap-2"
            onClick={() =>
              openExternal("https://github.com/yourusername/autai")
            }
          >
            <GitHubIcon className="h-4 w-4" />
            {t("resources.github")}
            <ExternalLink className="h-3 w-3 ml-auto" />
          </Button>
          <Button
            variant="outline"
            className="w-full justify-start gap-2"
            onClick={() =>
              openExternal("https://github.com/yourusername/autai/issues")
            }
          >
            <FileText className="h-4 w-4" />
            {t("resources.reportIssue")}
            <ExternalLink className="h-3 w-3 ml-auto" />
          </Button>
          <Button
            variant="outline"
            className="w-full justify-start gap-2"
            onClick={() =>
              openExternal("https://github.com/yourusername/autai/wiki")
            }
          >
            <FileText className="h-4 w-4" />
            {t("resources.documentation")}
            <ExternalLink className="h-3 w-3 ml-auto" />
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("credits.title")}</CardTitle>
          <CardDescription>{t("credits.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2 text-sm">
            <p className="flex items-center gap-2">
              <Heart className="h-3 w-3 text-red-500" />
              {t("credits.line1")}
            </p>
            <p className="text-muted-foreground">{t("credits.line2")}</p>
            <p className="text-muted-foreground">{t("credits.line3")}</p>
            <p className="text-muted-foreground">{t("credits.line4")}</p>
          </div>
          <Separator />
          <div className="text-xs text-muted-foreground">
            <p>{t("copyright")}</p>
            <p className="mt-1">{t("disclaimer")}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
