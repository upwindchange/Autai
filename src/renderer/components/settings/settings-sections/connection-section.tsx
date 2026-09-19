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
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { ShieldAlert, TriangleAlert } from "lucide-react";
import { useSettings } from "@/components/settings";
import { useTranslation } from "react-i18next";
import { getApiBase } from "@/lib/api";
import { hasRemoteOverride, hostOverride, portOverride } from "@/lib/env";
import { getAuthStatus, setPassword, clearPassword } from "@/lib/authClient";
import type { SettingsState, ServerMode } from "@shared";

interface ConnectionSectionProps {
  settings: SettingsState;
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

        <div className="flex flex-wrap gap-2">
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

        <div className="flex flex-wrap items-center justify-between gap-3">
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
  // The --remote CLI flag forces Remote Access for this run regardless of the
  // persisted mode; the UI must reflect what is actually serving (auth gate,
  // host/port bind), while the radio still shows the saved choice for the next
  // flag-free start. --host/--port additionally override this run's bind; the
  // host/port inputs below then display the CLI values (read-only mirror of
  // what is serving) instead of the saved values they would normally edit.
  const remoteOverride = hasRemoteOverride();
  const cliHost = hostOverride();
  const cliPort = portOverride();
  // Runtime view mirrors main's bind resolution: standalone binds 127.0.0.1 on
  // a random port; remote binds the configured host (default 0.0.0.0) and port
  // (default 8787).
  const runtimeMode: ServerMode =
    remoteOverride ? "remote" : settings.serverMode;
  const isStandalone = runtimeMode === "standalone";
  const bindOverridden = !isStandalone && (cliHost !== undefined || cliPort !== undefined);

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

      {remoteOverride && (
        <div className="flex items-start gap-2 rounded-md border border-chart-4/40 bg-chart-4/10 p-3 text-sm text-chart-4">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{t("connection.remoteOverride")}</span>
        </div>
      )}

      <div className="columns-1 gap-6 -mb-6 xl:columns-2 *:mb-6 *:break-inside-avoid">
        <Card>
          <CardHeader>
            <CardTitle>{t("connection.mode.title")}</CardTitle>
            <CardDescription>
              {t("connection.mode.description")}
            </CardDescription>
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
                      <HelpTooltip content={t(opt.tooltipKey)} />
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
            <CardDescription>
              {t("connection.host.description")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <Label htmlFor="server-host">
                  {t("connection.host.label")}
                </Label>
                <HelpTooltip content={t("connection.host.tooltip")} />
              </div>
              <Input
                id="server-host"
                className="w-full max-w-64"
                placeholder="0.0.0.0"
                value={
                  isStandalone ? "127.0.0.1"
                  : cliHost !== undefined ? cliHost
                  : settings.serverHost
                }
                disabled={isStandalone || cliHost !== undefined}
                onChange={(e) => handleHostChange(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("connection.port.title")}</CardTitle>
            <CardDescription>
              {t("connection.port.description")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <Label htmlFor="server-port">
                  {t("connection.port.label")}
                </Label>
                <HelpTooltip content={t("connection.port.tooltip")} />
              </div>
              <Input
                id="server-port"
                type="number"
                min={1}
                max={65535}
                className="w-full max-w-40"
                value={
                  isStandalone ? (runtimePort ?? "")
                  : cliPort !== undefined ? cliPort
                  : settings.serverPort
                }
                placeholder={
                  isStandalone ? t("connection.port.automatic") : "8787"
                }
                disabled={isStandalone || cliPort !== undefined}
                onChange={(e) => handlePortChange(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        {!isStandalone && <AuthSection />}
      </div>

      {bindOverridden && (
        <div className="flex items-start gap-2 rounded-md border border-chart-4/40 bg-chart-4/10 p-3 text-sm text-chart-4">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{t("connection.bindOverride")}</span>
        </div>
      )}

      <div className="flex items-start gap-2 rounded-md border border-chart-4/40 bg-chart-4/10 p-3 text-sm text-chart-4">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{t("connection.restartHint")}</span>
      </div>
    </div>
  );
}
