import { useState } from "react";
import {
  Card,
  CardHeader,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Pencil,
  Trash2,
  EyeIcon,
  EyeOffIcon,
  Save,
  Loader2,
  TestTube,
  Plug,
} from "lucide-react";
import { ModelList } from "./model-list";
import type { ProviderConfig, ProviderType } from "@shared";
import { getDefaultProvider } from "@shared";
import type { EditingProvider } from "../types";

const API_BASE = "http://localhost:3001";

const PROVIDER_TYPE_LABELS: Record<ProviderType, string> = {
  "openai-compatible": "OpenAI Compatible",
  anthropic: "Anthropic",
  deepinfra: "DeepInfra",
};

interface ProviderCardProps {
  provider: ProviderConfig;
  isEditing: boolean;
  isOnlyProvider: boolean;
  /** Which model roles this provider is assigned to */
  assignedRoles: string[];
  onEdit: () => void;
  onCancel: () => void;
  onSave: (provider: EditingProvider) => Promise<void>;
  onDelete: () => void;
}

export function ProviderCard({
  provider,
  isEditing,
  isOnlyProvider,
  assignedRoles,
  onEdit,
  onCancel,
  onSave,
  onDelete,
}: ProviderCardProps) {
  const [editState, setEditState] = useState<EditingProvider | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [selectedModel, setSelectedModel] = useState("");

  const startEditing = () => {
    setEditState({ ...provider, isNew: false });
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
          ...target,
          model: selectedModel || "test",
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
            <div className="space-y-2">
              <Label htmlFor="provider-name">Provider Name</Label>
              <Input
                id="provider-name"
                value={editState.name}
                onChange={(e) =>
                  setEditState({ ...editState, name: e.target.value })
                }
                placeholder="e.g., OpenAI Production"
              />
            </div>

            <div className="space-y-2">
              <Label>Provider Type</Label>
              <Select
                value={editState.provider}
                onValueChange={(value: ProviderType) => {
                  const defaults = getDefaultProvider(value);
                  setEditState({
                    ...editState,
                    provider: value,
                    apiKey: editState.apiKey || defaults.apiKey,
                    apiUrl: editState.apiUrl || defaults.apiUrl,
                  });
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai-compatible">
                    OpenAI Compatible
                  </SelectItem>
                  <SelectItem value="anthropic">Anthropic</SelectItem>
                  <SelectItem value="deepinfra">DeepInfra</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="api-url">API URL</Label>
              <Input
                id="api-url"
                value={editState.apiUrl || ""}
                onChange={(e) =>
                  setEditState({ ...editState, apiUrl: e.target.value })
                }
                onBlur={(e) => {
                  if (!e.target.value) {
                    const defaults = getDefaultProvider(editState.provider);
                    setEditState({ ...editState, apiUrl: defaults.apiUrl });
                  }
                }}
                placeholder={`Default: ${getDefaultProvider(editState.provider).apiUrl}`}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="api-key">API Key</Label>
              <div className="relative">
                <Input
                  id="api-key"
                  type={showApiKey ? "text" : "password"}
                  value={editState.apiKey}
                  onChange={(e) =>
                    setEditState({ ...editState, apiKey: e.target.value })
                  }
                  placeholder="sk-..."
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
              <>
                <div className="border-t pt-4">
                  <ModelList
                    provider={editState as ProviderConfig}
                    selectedModel={selectedModel}
                    onModelSelect={setSelectedModel}
                  />
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleTestConnection}
                  disabled={isTesting || !editState.apiKey}
                >
                  {isTesting ?
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  : <TestTube className="h-4 w-4 mr-2" />}
                  Test Connection
                </Button>
              </>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={handleCancel}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={isSaving}>
                {isSaving ?
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                : <Save className="h-4 w-4 mr-2" />}
                Save
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
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
              <Plug className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium truncate">{provider.name}</span>
                <Badge variant="secondary" className="shrink-0">
                  {PROVIDER_TYPE_LABELS[provider.provider]}
                </Badge>
              </div>
              <div className="text-xs text-muted-foreground truncate">
                {provider.apiUrl}
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
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={startEditing}>
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
