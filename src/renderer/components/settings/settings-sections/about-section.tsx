import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ExternalLink, Home, LifeBuoy, Shield } from "lucide-react";
import { useTranslation } from "react-i18next";
import { GitHubIcon } from "@/components/icons/github";
import { httpClient } from "@/lib/httpClient";
import appIcon from "@/app-icon.png";

const GITHUB_REPO_URL = "https://github.com/upwindchange/Autai";
const ISSUES_URL = `${GITHUB_REPO_URL}/issues`;
const PRIVACY_URL = `${GITHUB_REPO_URL}/blob/master/PRIVACY.md`;

const LINKS = [
  {
    key: "home",
    url: GITHUB_REPO_URL,
    labelKey: "links.home",
    icon: Home,
  },
  {
    key: "support",
    url: ISSUES_URL,
    labelKey: "links.support",
    icon: LifeBuoy,
  },
  {
    key: "privacy",
    url: PRIVACY_URL,
    labelKey: "links.privacy",
    icon: Shield,
  },
] as const;

export function AboutSection() {
  const { t } = useTranslation("about");
  const [version, setVersion] = useState("");
  const [systemInfo, setSystemInfo] = useState<{
    platform: string;
    electronVersion: string;
    nodeVersion: string;
  }>({ platform: "", electronVersion: "", nodeVersion: "" });

  useEffect(() => {
    httpClient
      .postJSON<{ version: string }>("/app/version")
      .then(({ version }) => setVersion(version))
      .catch(() => undefined);

    httpClient
      .postJSON<{
        platform: string;
        electronVersion: string;
        nodeVersion: string;
      }>("/app/system-info")
      .then(setSystemInfo)
      .catch(() => undefined);
  }, []);

  // window.open is intercepted by the native shell's setWindowOpenHandler
  // (→ SplitView) in native mode and opens a plain new tab in a browser, so the
  // same call works in both environments without a shell round-trip.
  const openExternal = (url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
  };

  // process.platform is a Node identifier ("win32", "darwin", "linux") —
  // map it to the name a user expects on an About page.
  const platformName =
    {
      win32: "Windows",
      darwin: "macOS",
      linux: "Linux",
    }[systemInfo.platform] ?? systemInfo.platform;

  const infoRows: Array<{ label: string; value: string }> = [
    { label: t("info.version"), value: version },
    { label: t("info.platform"), value: platformName },
    { label: t("info.electron"), value: systemInfo.electronVersion },
    { label: t("info.nodejs"), value: systemInfo.nodeVersion },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">{t("title")}</h2>
        <p className="text-muted-foreground mt-1">{t("subtitle")}</p>
      </div>

      <div className="columns-1 gap-6 -mb-6 xl:columns-2 *:mb-6 *:break-inside-avoid">
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
          <div className="flex flex-col items-center gap-4 p-8">
            <img
              src={appIcon}
              alt="Autai"
              className="size-32 rounded-2xl shadow-md"
            />
            <div className="text-center">
              <p className="text-xl font-semibold">Autai</p>
              <p className="text-sm text-muted-foreground">
                {t("tagline")}
              </p>
            </div>
            {version && (
              <span className="rounded-full bg-muted px-3 py-0.5 font-mono text-xs">
                v{version}
              </span>
            )}
            <p className="text-sm text-muted-foreground">
              {t("info.author")} · {t("info.authorName")}
            </p>
          </div>
        </div>

        <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
          <div className="flex flex-col gap-3 p-6">
            <p className="text-sm font-medium text-muted-foreground">
              {t("links.title")}
            </p>
            {LINKS.map(({ key, url, labelKey, icon: Icon }) => (
              <Button
                key={key}
                variant="outline"
                className="w-full justify-start gap-2"
                onClick={() => openExternal(url)}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{t(labelKey)}</span>
                <ExternalLink className="h-3 w-3 ml-auto shrink-0" />
              </Button>
            ))}
            <Separator />
            <Button
              variant="outline"
              className="w-full justify-start gap-2"
              onClick={() => openExternal(GITHUB_REPO_URL)}
            >
              <GitHubIcon className="h-4 w-4 shrink-0" />
              <span className="truncate">{t("links.source")}</span>
              <ExternalLink className="h-3 w-3 ml-auto shrink-0" />
            </Button>
          </div>
        </div>

        <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
          <div className="p-6">
            <p className="text-sm font-medium text-muted-foreground">
              {t("info.title")}
            </p>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {infoRows.map(({ label, value }) => (
                <div key={label} className="min-w-0">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="truncate font-mono text-sm">
                    {value || t("common:value.unknown")}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
          <div className="p-6">
            <p className="text-sm font-medium text-muted-foreground">
              {t("legal.title")}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              {t("copyright")}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("disclaimer")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
