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
import { GitHubIcon } from "@/components/icons/github";
import { httpClient } from "@/lib/httpClient";

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
    httpClient
      .postJSON<{ version: string }>("/app/version")
      .then(({ version }) => {
        setAppVersion(version);
      })
      .catch(() => {
        setAppVersion(t("common:value.unknown"));
      });

    // Get system info from main process
    httpClient
      .postJSON<{
        platform: string;
        electronVersion: string;
        nodeVersion: string;
      }>("/app/system-info")
      .then((systemInfo) => {
        setPlatform(systemInfo.platform);
        setElectronVersion(systemInfo.electronVersion);
        setNodeVersion(systemInfo.nodeVersion);
      })
      .catch(() => {
        setPlatform(t("common:value.unknown"));
        setElectronVersion(t("common:value.unknown"));
        setNodeVersion(t("common:value.unknown"));
      });
  }, [t]);

  // window.open is intercepted by the native shell's setWindowOpenHandler
  // (→ SplitView) in native mode and opens a plain new tab in a browser, so the
  // same call works in both environments without a shell round-trip.
  const openExternal = (url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">{t("title")}</h2>
        <p className="text-muted-foreground mt-1">{t("subtitle")}</p>
      </div>

      <div className="columns-1 gap-6 -mb-6 xl:columns-2 *:mb-6 *:break-inside-avoid">
        <Card>
          <CardHeader>
            <CardTitle>{t("info.title")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="min-w-0">
                <p className="text-sm text-muted-foreground">
                  {t("info.version")}
                </p>
                <p className="font-mono truncate">{appVersion}</p>
              </div>
              <div className="min-w-0">
                <p className="text-sm text-muted-foreground">
                  {t("info.platform")}
                </p>
                <p className="font-mono truncate">{platform}</p>
              </div>
              <div className="min-w-0">
                <p className="text-sm text-muted-foreground">
                  {t("info.electron")}
                </p>
                <p className="font-mono truncate">{electronVersion}</p>
              </div>
              <div className="min-w-0">
                <p className="text-sm text-muted-foreground">
                  {t("info.nodejs")}
                </p>
                <p className="font-mono truncate">{nodeVersion}</p>
              </div>
              <div className="min-w-0">
                <p className="text-sm text-muted-foreground">
                  {t("info.author")}
                </p>
                <p>{t("info.authorName")}</p>
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
                openExternal("https://github.com/upwindchange/Autai")
              }
            >
              <GitHubIcon className="h-4 w-4 shrink-0" />
              <span className="truncate">{t("resources.github")}</span>
              <ExternalLink className="h-3 w-3 ml-auto shrink-0" />
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start gap-2"
              onClick={() =>
                openExternal("https://github.com/upwindchange/Autai/issues")
              }
            >
              <FileText className="h-4 w-4 shrink-0" />
              <span className="truncate">{t("resources.reportIssue")}</span>
              <ExternalLink className="h-3 w-3 ml-auto shrink-0" />
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start gap-2"
              onClick={() =>
                openExternal("https://github.com/upwindchange/Autai")
              }
            >
              <FileText className="h-4 w-4 shrink-0" />
              <span className="truncate">{t("resources.documentation")}</span>
              <ExternalLink className="h-3 w-3 ml-auto shrink-0" />
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
                <Heart className="h-3 w-3 shrink-0 text-red-500" />
                {t("credits.intro")}
              </p>
            </div>
            <div className="space-y-2">
              <Button
                variant="outline"
                className="w-full justify-start gap-2"
                onClick={() => openExternal("https://www.electronjs.org")}
              >
                <span className="font-medium shrink-0">Electron</span>
                <span className="text-xs text-muted-foreground truncate">
                  {t("credits.electron")}
                </span>
                <ExternalLink className="h-3 w-3 ml-auto shrink-0" />
              </Button>
              <Button
                variant="outline"
                className="w-full justify-start gap-2"
                onClick={() => openExternal("https://www.assistant-ui.com")}
              >
                <span className="font-medium shrink-0">Assistant UI</span>
                <span className="text-xs text-muted-foreground truncate">
                  {t("credits.assistantUI")}
                </span>
                <ExternalLink className="h-3 w-3 ml-auto shrink-0" />
              </Button>
              <Button
                variant="outline"
                className="w-full justify-start gap-2"
                onClick={() => openExternal("https://sdk.vercel.ai")}
              >
                <span className="font-medium shrink-0">AI SDK</span>
                <span className="text-xs text-muted-foreground truncate">
                  {t("credits.aiSDK")}
                </span>
                <ExternalLink className="h-3 w-3 ml-auto shrink-0" />
              </Button>
              <Button
                variant="outline"
                className="w-full justify-start gap-2"
                onClick={() =>
                  openExternal(
                    "https://github.com/upwindchange/Autai/blob/master/package.json",
                  )
                }
              >
                <span className="text-muted-foreground text-xs truncate">
                  {t("credits.more")}
                </span>
                <ExternalLink className="h-3 w-3 ml-auto shrink-0" />
              </Button>
            </div>
            <div className="space-y-2 text-sm">
              <p className="font-medium">{t("credits.specialThanks")}</p>
              <Button
                variant="outline"
                className="w-full justify-start gap-2"
                onClick={() =>
                  openExternal("https://github.com/browser-use/browser-use")
                }
              >
                <span className="font-medium shrink-0">Browser-Use</span>
                <span className="text-xs text-muted-foreground truncate">
                  {t("credits.browserUse")}
                </span>
                <ExternalLink className="h-3 w-3 ml-auto shrink-0" />
              </Button>
            </div>
            <Separator />
            <div className="text-xs text-muted-foreground">
              <p>{t("copyright")}</p>
              <p className="mt-1">{t("disclaimer")}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
