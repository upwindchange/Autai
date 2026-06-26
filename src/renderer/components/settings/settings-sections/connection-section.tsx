import { useCallback, useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CircleHelp, ShieldAlert } from "lucide-react";
import { useSettings } from "@/components/settings";
import { useTranslation } from "react-i18next";
import { getApiBase } from "@/lib/api";
import { getAuthStatus, setPassword, clearPassword } from "@/lib/authClient";
import type { SettingsState, ServerMode } from "@shared";

interface ConnectionSectionProps {
  settings: SettingsState;
}

function HelpIcon({ label }: { label: string }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <CircleHelp className="h-4 w-4 text-muted-foreground" />
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

const MODE_OPTIONS: {
  value: ServerMode;
  labelKey: string;
  descKey: string;
  tooltipKey: string;
}[] = [
  {
    value: "standalone",
    labelKey: "connection.mode.standalone.label",
    descKey: "connection.mode.standalone.description",
    tooltipKey: "connection.mode.standalone.tooltip",
  },
  {
    value: "remote",
    labelKey: "connection.mode.remote.label",
    descKey: "connection.mode.remote.description",
    tooltipKey: "connection.mode.remote.tooltip",
  },
];

/**
 * Owner password configuration for Remote Access. The password is derived
 * client-side and sent only over loopback (the desktop owner), so the raw
 * password never leaves this machine. Shown only in Remote Access mode.
 */
function AuthSection() {
  const { t } = useTranslation("settings");
  const { settings, updateSettings } = useSettings();
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);
  const [pw, setPw] = useState("");
  // Local string state so the days field can be typed/cleared freely; committed
  // to settings only when it parses to a valid (>=1) number.
  const [daysInput, setDaysInput] = useState(String(settings.sessionTtlDays));
  useEffect(() => {
    setDaysInput(String(settings.sessionTtlDays));
  }, [settings.sessionTtlDays]);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setHasPassword((await getAuthStatus()).passwordSet);
    } catch {
      setHasPassword(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleSave = async () => {
    if (busy) return;
    if (pw.length < 8) {
      setError(t("connection.auth.tooShort"));
      return;
    }
    if (pw !== confirm) {
      setError(t("connection.auth.mismatch"));
      return;
    }
    setBusy(true);
    setError(null);
    const ok = await setPassword(pw);
    setBusy(false);
    if (ok) {
      setPw("");
      setConfirm("");
      await refresh();
    } else {
      setError(t("connection.auth.error"));
    }
  };

  const handleRemove = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const ok = await clearPassword();
    setBusy(false);
    if (ok) {
      setPw("");
      setConfirm("");
      await refresh();
    } else {
      setError(t("connection.auth.error"));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("connection.auth.title")}</CardTitle>
        <CardDescription>{t("connection.auth.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {hasPassword ?
            t("connection.auth.status.set")
          : t("connection.auth.status.notSet")}
        </p>

        {!hasPassword && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{t("connection.auth.unprotectedWarning")}</span>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="auth-password">
            {t("connection.auth.password.label")}
          </Label>
          <Input
            id="auth-password"
            type="password"
            autoComplete="new-password"
            placeholder={t("connection.auth.password.placeholder")}
            value={pw}
            onChange={(e) => setPw(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="auth-confirm">
            {t("connection.auth.confirm.label")}
          </Label>
          <Input
            id="auth-confirm"
            type="password"
            autoComplete="new-password"
            placeholder={t("connection.auth.confirm.placeholder")}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex gap-2">
          <Button onClick={handleSave} disabled={busy || !pw}>
            {hasPassword ?
              t("connection.auth.change")
            : t("connection.auth.set")}
          </Button>
          {hasPassword && (
            <Button variant="outline" onClick={handleRemove} disabled={busy}>
              {t("connection.auth.remove")}
            </Button>
          )}
        </div>

        <Separator />

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="session-expires">
              {t("connection.auth.expiration.label")}
            </Label>
            <p className="text-sm text-muted-foreground">
              {settings.sessionExpires ?
                t("connection.auth.expiration.hintOn")
              : t("connection.auth.expiration.hintOff")}
            </p>
          </div>
          <Switch
            id="session-expires"
            checked={settings.sessionExpires}
            onCheckedChange={(checked) =>
              updateSettings({ ...settings, sessionExpires: checked })
            }
          />
        </div>

        {settings.sessionExpires && (
          <div className="flex items-center gap-2">
            <Input
              id="session-ttl"
              type="number"
              min={1}
              className="w-24"
              value={daysInput}
              onChange={(e) => {
                setDaysInput(e.target.value);
                const n = parseInt(e.target.value, 10);
                if (!isNaN(n) && n >= 1) {
                  updateSettings({ ...settings, sessionTtlDays: n });
                }
              }}
            />
            <span className="text-sm text-muted-foreground">
              {t("connection.auth.expiration.days")}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ConnectionSection({ settings }: ConnectionSectionProps) {
  const { updateSettings } = useSettings();
  const { t } = useTranslation("settings");
  const isStandalone = settings.serverMode === "standalone";

  // In Local Mode the port is chosen at random by the OS; fetch the running
  // value from /health so the (read-only) field shows what is actually in use.
  const [runtimePort, setRuntimePort] = useState<number | null>(null);
  useEffect(() => {
    if (!isStandalone) {
      setRuntimePort(null);
      return;
    }
    let cancelled = false;
    fetch(`${getApiBase()}/health`)
      .then((r) => r.json())
      .then((d: { port?: number }) => {
        if (!cancelled && typeof d.port === "number") setRuntimePort(d.port);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isStandalone]);

  const handleModeChange = async (mode: string) => {
    if (mode !== "standalone" && mode !== "remote") return;
    await updateSettings({ ...settings, serverMode: mode as ServerMode });
  };

  const handleHostChange = async (host: string) => {
    await updateSettings({ ...settings, serverHost: host });
  };

  const handlePortChange = async (value: string) => {
    const num = parseInt(value, 10);
    if (isNaN(num) || num < 1 || num > 65535) return;
    await updateSettings({ ...settings, serverPort: num });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">{t("connection.title")}</h2>
        <p className="text-muted-foreground mt-1">{t("connection.subtitle")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("connection.mode.title")}</CardTitle>
          <CardDescription>{t("connection.mode.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <RadioGroup
            value={settings.serverMode}
            onValueChange={handleModeChange}
            className="gap-2"
          >
            {MODE_OPTIONS.map((opt) => (
              <div
                key={opt.value}
                className="flex items-start gap-3 rounded-md border p-3"
              >
                <RadioGroupItem
                  value={opt.value}
                  id={`mode-${opt.value}`}
                  className="mt-0.5"
                />
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    <Label htmlFor={`mode-${opt.value}`}>
                      {t(opt.labelKey)}
                    </Label>
                    <HelpIcon label={t(opt.tooltipKey)} />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {t(opt.descKey)}
                  </p>
                </div>
              </div>
            ))}
          </RadioGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("connection.host.title")}</CardTitle>
          <CardDescription>{t("connection.host.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="server-host">{t("connection.host.label")}</Label>
              <HelpIcon label={t("connection.host.tooltip")} />
            </div>
            <Input
              id="server-host"
              className="w-64"
              placeholder="0.0.0.0"
              value={isStandalone ? "127.0.0.1" : settings.serverHost}
              disabled={isStandalone}
              onChange={(e) => handleHostChange(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("connection.port.title")}</CardTitle>
          <CardDescription>{t("connection.port.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="server-port">{t("connection.port.label")}</Label>
              <HelpIcon label={t("connection.port.tooltip")} />
            </div>
            <Input
              id="server-port"
              type="number"
              min={1}
              max={65535}
              className="w-40"
              value={isStandalone ? (runtimePort ?? "") : settings.serverPort}
              placeholder={
                isStandalone ? t("connection.port.automatic") : "8787"
              }
              disabled={isStandalone}
              onChange={(e) => handlePortChange(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {!isStandalone && <AuthSection />}

      <p className="text-sm text-muted-foreground">
        {t("connection.restartHint")}
      </p>
    </div>
  );
}
