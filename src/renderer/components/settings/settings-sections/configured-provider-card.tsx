import { useState } from "react";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import {
  Pencil,
  Trash2,
  EyeIcon,
  EyeOffIcon,
  Save,
  Loader2,
  TestTube,
  ChevronDown,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { TomlModelList } from "./toml-model-list";
import type { UserProviderConfig, ProviderDefinition } from "@shared";

const API_BASE = "http://localhost:3001";

interface ConfiguredProviderCardProps {
  provider: UserProviderConfig;
  definition: ProviderDefinition;
  isEditing: boolean;
  isOnlyProvider: boolean;
  assignedRoles: string[];
  onEdit: () => void;
  onCancel: () => void;
  onSave: (provider: UserProviderConfig) => Promise<void>;
  onDelete: () => void;
}

export function ConfiguredProviderCard({
  provider,
  definition,
  isEditing,
  isOnlyProvider,
  assignedRoles,
  onEdit,
  onCancel,
  onSave,
  onDelete,
}: ConfiguredProviderCardProps) {
  const [editState, setEditState] = useState<UserProviderConfig | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [selectedModel, setSelectedModel] = useState("");
  const [modelsOpen, setModelsOpen] = useState(false);
  const { t } = useTranslation("providers");

  const startEditing = () => {
    setEditState({ ...provider });
    setSelectedModel("");
    onEdit();
  };

  const handleSave = async () => {
    if (!editState) return;
    setIsSaving(true);
    try {
      await onSave(editState);
      setEditState(null);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setEditState(null);
    onCancel();
  };

  const handleTestConnection = async () => {
    const target = editState || provider;
    if (!target.apiKey) return;

    setIsTesting(true);
    try {
      await fetch(`${API_BASE}/settings/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerDir: target.providerDir,
          apiKey: target.apiKey,
          ...(target.apiUrlOverride && {
            apiUrlOverride: target.apiUrlOverride,
          }),
          modelFile: selectedModel || "test",
        }),
      });
    } finally {
      setIsTesting(false);
    }
  };

  // Edit mode
  if (isEditing && editState) {
    return (
      <Card className="border-primary">
        <CardHeader className="pb-4">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              {definition.logo && (
                <span
                  className="h-8 w-8 shrink-0 text-foreground [&_svg]:h-full [&_svg]:w-full"
                  dangerouslySetInnerHTML={{ __html: definition.logo }}
                />
              )}
              <div>
                <span className="font-medium">{definition.name}</span>
                <Badge variant="secondary" className="ml-2 text-xs">
                  {definition.npm === "@ai-sdk/openai-compatible"
                    ? "OpenAI Compatible"
                    : definition.npm.replace("@ai-sdk/", "")}
                </Badge>
              </div>
            </div>

            {definition.api && (
              <div className="space-y-2">
                <Label htmlFor="api-url-override">
                  {t("form.apiUrlOverride.label")}
                </Label>
                <Input
                  id="api-url-override"
                  value={editState.apiUrlOverride || ""}
                  onChange={(e) =>
                    setEditState({
                      ...editState,
                      apiUrlOverride: e.target.value || undefined,
                    })
                  }
                  placeholder={definition.api}
                />
                <p className="text-xs text-muted-foreground">
                  {t("form.apiUrlOverride.hint")}
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="api-key">{t("form.apiKey.label")}</Label>
              <div className="relative">
                <Input
                  id="api-key"
                  type={showApiKey ? "text" : "password"}
                  value={editState.apiKey}
                  onChange={(e) =>
                    setEditState({ ...editState, apiKey: e.target.value })
                  }
                  placeholder={`${definition.env[0] || "API Key"}...`}
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full px-3"
                  onClick={() => setShowApiKey(!showApiKey)}
                >
                  {showApiKey ?
                    <EyeOffIcon className="h-4 w-4" />
                  : <EyeIcon className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            {editState.apiKey && (
              <Collapsible open={modelsOpen} onOpenChange={setModelsOpen}>
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent transition-colors"
                  >
                    {t("modelsAndTesting")}
                    <ChevronDown
                      className={`h-4 w-4 transition-transform ${modelsOpen ? "rotate-180" : ""}`}
                    />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-4 pt-3">
                  <TomlModelList
                    providerDir={editState.providerDir}
                    selectedModel={selectedModel}
                    onModelSelect={setSelectedModel}
                  />

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleTestConnection}
                    disabled={isTesting || !editState.apiKey}
                  >
                    {isTesting ?
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    : <TestTube className="h-4 w-4 mr-2" />}
                    {t("btn.testConnection")}
                  </Button>
                </CollapsibleContent>
              </Collapsible>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={handleCancel}>
                {t("common:btn.cancel")}
              </Button>
              <Button onClick={handleSave} disabled={isSaving}>
                {isSaving ?
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                : <Save className="h-4 w-4 mr-2" />}
                {t("common:btn.save")}
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>
    );
  }

  // Summary mode
  return (
    <Card>
      <CardHeader className="py-4 px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            {definition.logo && (
              <span
                className="h-8 w-8 shrink-0 text-foreground [&_svg]:h-full [&_svg]:w-full"
                dangerouslySetInnerHTML={{ __html: definition.logo }}
              />
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium truncate">{definition.name}</span>
                <Badge variant="secondary" className="shrink-0 text-xs">
                  {definition.npm === "@ai-sdk/openai-compatible"
                    ? "OpenAI Compatible"
                    : definition.npm.replace("@ai-sdk/", "")}
                </Badge>
              </div>
              <div className="text-xs text-muted-foreground truncate">
                {provider.apiUrlOverride || definition.api || definition.npm}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {assignedRoles.length > 0 && (
              <div className="flex gap-1 mr-2">
                {assignedRoles.map((role) => (
                  <Badge key={role} variant="outline" className="text-xs">
                    {role}
                  </Badge>
                ))}
              </div>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={startEditing}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            {!isOnlyProvider && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={onDelete}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
    </Card>
  );
}
