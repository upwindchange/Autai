import { useState, useEffect, useCallback } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { ToolCase, Trash2, Pencil, Wifi, WifiOff, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getApiBase } from "@/lib/api";
import type { McpTransportType } from "@shared";

interface McpServerRow {
  id: string;
  name: string;
  description: string | null;
  transportType: string;
  connectionConfig: string;
  enabled: string;
}

interface McpTestResult {
  success: boolean;
  error?: string;
  toolCount?: number;
  toolNames?: string[];
}

interface FormData {
  name: string;
  description: string;
  transportType: McpTransportType;
  url: string;
  headers: string;
}

const emptyForm: FormData = {
  name: "",
  description: "",
  transportType: "http",
  url: "",
  headers: "",
};

function parseHeaders(text: string): Record<string, string> | undefined {
  if (!text.trim()) return undefined;
  const headers: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      if (key) headers[key] = value;
    }
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}

export function McpServersSection() {
  const { t } = useTranslation("mcp-servers");
  const [servers, setServers] = useState<McpServerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<McpServerRow | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [testResults, setTestResults] = useState<Record<string, McpTestResult>>(
    {},
  );
  const [testingId, setTestingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchServers = useCallback(async () => {
    try {
      const res = await fetch(`${getApiBase()}/mcp/servers`);
      const data = await res.json();
      setServers(data);
    } catch (error) {
      console.error("Failed to fetch MCP servers:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchServers();
  }, [fetchServers]);

  const handleOpenAdd = () => {
    setEditingServer(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const handleOpenEdit = (server: McpServerRow) => {
    setEditingServer(server);
    const config = JSON.parse(server.connectionConfig) as {
      url?: string;
      headers?: Record<string, string>;
    };
    const headerLines =
      config.headers ?
        Object.entries(config.headers)
          .map(([k, v]) => `${k}: ${v}`)
          .join("\n")
      : "";
    setForm({
      name: server.name,
      description: server.description || "",
      transportType: server.transportType as McpTransportType,
      url: config.url || "",
      headers: headerLines,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const connectionConfig: Record<string, unknown> = {
        url: form.url,
        headers: parseHeaders(form.headers),
      };
      const payload = {
        name: form.name,
        description: form.description || undefined,
        transportType: form.transportType,
        connectionConfig,
        enabled: true,
      };

      if (editingServer) {
        await fetch(`${getApiBase()}/mcp/servers/${editingServer.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        await fetch(`${getApiBase()}/mcp/servers`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      setDialogOpen(false);
      await fetchServers();
    } catch (error) {
      console.error("Failed to save MCP server:", error);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t("delete.confirm"))) return;
    try {
      await fetch(`${getApiBase()}/mcp/servers/${id}`, { method: "DELETE" });
      await fetchServers();
    } catch (error) {
      console.error("Failed to delete MCP server:", error);
    }
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      await fetch(`${getApiBase()}/mcp/servers/${id}/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      await fetchServers();
    } catch (error) {
      console.error("Failed to toggle MCP server:", error);
    }
  };

  const handleTest = async (id: string) => {
    setTestingId(id);
    setTestResults((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    try {
      const res = await fetch(`${getApiBase()}/mcp/servers/${id}/test`, {
        method: "POST",
      });
      const result: McpTestResult = await res.json();
      setTestResults((prev) => ({ ...prev, [id]: result }));
    } catch {
      setTestResults((prev) => ({
        ...prev,
        [id]: { success: false, error: "Network error" },
      }));
    } finally {
      setTestingId(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold">{t("title")}</h2>
          <p className="text-muted-foreground mt-1">{t("subtitle")}</p>
        </div>
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            {t("common:btn.loading")}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">{t("title")}</h2>
        <p className="text-muted-foreground mt-1">{t("subtitle")}</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{t("serverList.title")}</CardTitle>
              <CardDescription>{t("serverList.description")}</CardDescription>
            </div>
            <Button onClick={handleOpenAdd} className="gap-2">
              <ToolCase className="h-4 w-4" />
              {t("serverList.add")}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {servers.length === 0 ?
            <p className="text-muted-foreground text-sm py-4">
              {t("serverList.empty")}
            </p>
          : <div className="space-y-4">
              {servers.map((server) => {
                const testResult = testResults[server.id];
                const isTesting = testingId === server.id;
                const isEnabled = server.enabled === "true";

                return (
                  <div
                    key={server.id}
                    className="flex items-start gap-4 rounded-lg border p-4"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">
                          {server.name}
                        </span>
                        <Badge variant="secondary">
                          {t(`badge.${server.transportType}`)}
                        </Badge>
                        {testResult?.success && (
                          <Badge
                            variant="outline"
                            className="text-green-600 border-green-300 dark:text-green-400 dark:border-green-800"
                          >
                            <Wifi className="h-3 w-3 mr-1" />
                            {testResult.toolCount}{" "}
                            {testResult.toolCount === 1 ? "tool" : "tools"}
                          </Badge>
                        )}
                        {testResult && !testResult.success && (
                          <Badge
                            variant="outline"
                            className="text-red-600 border-red-300 dark:text-red-400 dark:border-red-800"
                          >
                            <WifiOff className="h-3 w-3 mr-1" />
                            {t("test.failed")}
                          </Badge>
                        )}
                      </div>
                      {server.description && (
                        <p className="text-sm text-muted-foreground mt-0.5">
                          {server.description}
                        </p>
                      )}
                      {testResult?.error && (
                        <p className="text-xs text-destructive mt-1">
                          {testResult.error}
                        </p>
                      )}
                      {testResult?.success && testResult.toolNames && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {t("test.toolList", {
                            tools: testResult.toolNames.join(", "),
                          })}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleTest(server.id)}
                        disabled={isTesting}
                        className="gap-1"
                      >
                        {isTesting ?
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <Wifi className="h-3.5 w-3.5" />}
                        {isTesting ? t("test.testing") : t("test.button")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleOpenEdit(server)}
                        title={t("edit.button")}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(server.id)}
                        title={t("delete.button")}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                      <Switch
                        checked={isEnabled}
                        onCheckedChange={(checked) =>
                          handleToggle(server.id, checked)
                        }
                        aria-label={
                          isEnabled ? t("enabled.label") : t("disabled.label")
                        }
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          }
        </CardContent>
      </Card>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingServer ? t("edit.button") : t("serverList.add")}
            </DialogTitle>
            <DialogDescription>
              {editingServer ?
                t("form.description.placeholder")
              : t("serverList.description")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="mcp-name">{t("form.name.label")}</Label>
              <Input
                id="mcp-name"
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
                placeholder={t("form.name.placeholder")}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="mcp-description">
                {t("form.description.label")}
              </Label>
              <Input
                id="mcp-description"
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
                placeholder={t("form.description.placeholder")}
              />
            </div>

            <Separator />

            <div className="space-y-2">
              <Label>{t("form.transportType.label")}</Label>
              <RadioGroup
                value={form.transportType}
                onValueChange={(v) =>
                  setForm((f) => ({
                    ...f,
                    transportType: v as McpTransportType,
                  }))
                }
                className="flex gap-4"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="http" id="transport-http" />
                  <Label htmlFor="transport-http" className="cursor-pointer">
                    {t("form.transportType.http")}
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="sse" id="transport-sse" />
                  <Label htmlFor="transport-sse" className="cursor-pointer">
                    {t("form.transportType.sse")}
                  </Label>
                </div>
              </RadioGroup>
            </div>

            <div className="space-y-2">
              <Label htmlFor="mcp-url">{t("form.url.label")}</Label>
              <Input
                id="mcp-url"
                type="url"
                value={form.url}
                onChange={(e) =>
                  setForm((f) => ({ ...f, url: e.target.value }))
                }
                placeholder={t("form.url.placeholder")}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="mcp-headers">{t("form.headers.label")}</Label>
              <Input
                id="mcp-headers"
                value={form.headers}
                onChange={(e) =>
                  setForm((f) => ({ ...f, headers: e.target.value }))
                }
                placeholder={t("form.headers.placeholder")}
              />
              <p className="text-xs text-muted-foreground">
                {t("form.headers.hint")}
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={saving}
            >
              {t("cancel.button")}
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || !form.name || !form.url}
            >
              {saving ? t("common:btn.loading") : t("save.button")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
