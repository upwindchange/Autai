import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { X, Pencil, Check, Plus, RotateCcw, Loader2 } from "lucide-react";
import { useSettings } from "@/components/settings";
import { useTranslation } from "react-i18next";
import type { SettingsState } from "@shared";
import type { TagRow, ThreadMode } from "@shared/tag";
import log from "electron-log/renderer";
import { getApiBase } from "@/lib/api";
import { ColorPicker } from "@/components/ui/color-picker";
import { getRandomPaletteColor } from "@/lib/tagColors";
import { resetTagsToDefault } from "@/lib/tagApi";
import {
  ModelParamsFields,
  type ModelParamsValue,
} from "@/components/settings/settings-sections/model-params-fields";

const logger = log.scope("ThreadsSection");

interface ThreadsSectionProps {
  settings: SettingsState;
}

export function ThreadsSection({ settings }: ThreadsSectionProps) {
  const { updateSettings } = useSettings();
  const { t } = useTranslation("threads");
  const [tags, setTags] = useState<TagRow[]>([]);

  useEffect(() => {
    loadTags();
  }, []);

  const loadTags = async () => {
    try {
      const res = await fetch(`${getApiBase()}/tags`);
      const data = (await res.json()) as { tags: TagRow[] };
      setTags(data.tags);
    } catch (error) {
      logger.error("Failed to load tags:", error);
    }
  };

  const handleAutoTagToggle = async (enabled: boolean) => {
    const newSettings: SettingsState = {
      ...settings,
      autoTagEnabled: enabled,
    };
    await updateSettings(newSettings);
  };

  const handleAutoTagCreationToggle = async (enabled: boolean) => {
    const newSettings: SettingsState = {
      ...settings,
      autoTagCreationEnabled: enabled,
    };
    await updateSettings(newSettings);
  };

  // --- Default chat params (system-level) ---
  // Draft + Save (configured-provider-card pattern) — a textarea doesn't suit
  // per-keystroke PUT. The draft seeds from live settings; Save commits the
  // whole {systemPrompt, params} blob at once.
  const [paramsDraft, setParamsDraft] = useState<ModelParamsValue>(() => ({
    systemPrompt: settings.systemPrompt ?? null,
    params: settings.defaultModelParams ?? null,
  }));
  const [paramsSaving, setParamsSaving] = useState(false);

  // Re-seed when settings load/change externally (e.g. first load).
  useEffect(() => {
    setParamsDraft({
      systemPrompt: settings.systemPrompt ?? null,
      params: settings.defaultModelParams ?? null,
    });
  }, [settings.systemPrompt, settings.defaultModelParams]);

  const handleSaveParams = async () => {
    setParamsSaving(true);
    logger.info("Saving system-level default chat params", {
      hasSystemPrompt: !!paramsDraft.systemPrompt,
      hasParams: !!paramsDraft.params,
      paramKeys: paramsDraft.params ? Object.keys(paramsDraft.params) : [],
    });
    try {
      await updateSettings({
        ...settings,
        systemPrompt: paramsDraft.systemPrompt ?? "",
        defaultModelParams: paramsDraft.params ?? undefined,
      });
    } catch (err) {
      logger.error("Failed to save default chat params:", err);
    } finally {
      setParamsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">{t("title")}</h2>
        <p className="text-muted-foreground mt-1">{t("subtitle")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("autoTag.title")}</CardTitle>
          <CardDescription>{t("autoTag.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="auto-tag-enabled">
                {t("autoTag.enabled.label")}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t("autoTag.enabled.hint")}
              </p>
            </div>
            <Switch
              id="auto-tag-enabled"
              checked={settings.autoTagEnabled}
              onCheckedChange={handleAutoTagToggle}
            />
          </div>

          {settings.autoTagEnabled && (
            <>
              <Separator />
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="auto-tag-creation-enabled">
                    {t("autoTag.creation.label")}
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    {t("autoTag.creation.hint")}
                  </p>
                </div>
                <Switch
                  id="auto-tag-creation-enabled"
                  checked={settings.autoTagCreationEnabled}
                  onCheckedChange={handleAutoTagCreationToggle}
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("defaultChatParams.title")}</CardTitle>
          <CardDescription>
            {t("defaultChatParams.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ModelParamsFields
            value={paramsDraft}
            onChange={setParamsDraft}
            systemPromptPlaceholder={t("defaultChatParams.systemPromptEmpty")}
            i18nNamespace="threads"
            keyPrefix="defaultChatParams"
          />
          <div className="flex justify-end pt-1">
            <Button onClick={handleSaveParams} disabled={paramsSaving}>
              {paramsSaving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                t("defaultChatParams.save")
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("tagManagement.title")}</CardTitle>
          <CardDescription>{t("tagManagement.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="chat">
            <TabsList>
              <TabsTrigger value="chat">
                {t("tagManagement.chatTab")}
              </TabsTrigger>
              <TabsTrigger value="entertainment">
                {t("tagManagement.entertainmentTab")}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="chat">
              <TagManager
                mode="chat"
                tags={tags.filter((tag) => tag.mode === "chat")}
                onChanged={loadTags}
              />
            </TabsContent>
            <TabsContent value="entertainment">
              <TagManager
                mode="entertainment"
                tags={tags.filter((tag) => tag.mode === "entertainment")}
                onChanged={loadTags}
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

// Mode-scoped tag editor used once per tab. Owns its own create/edit/delete
// state and the per-mode "Reset to default" action.
interface TagManagerProps {
  mode: ThreadMode;
  tags: TagRow[];
  onChanged: () => Promise<void> | void;
}

function TagManager({ mode, tags, onChanged }: TagManagerProps) {
  const { t } = useTranslation("threads");
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState<string>(
    getRandomPaletteColor(),
  );
  const [editingTagId, setEditingTagId] = useState<number | null>(null);
  const [editingTagName, setEditingTagName] = useState("");
  const [editingTagColor, setEditingTagColor] = useState("");

  const handleCreateTag = async () => {
    const name = newTagName.trim();
    if (!name) return;
    try {
      await fetch(`${getApiBase()}/tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, color: newTagColor, mode }),
      });
      setNewTagName("");
      setNewTagColor(getRandomPaletteColor());
      await onChanged();
    } catch (error) {
      logger.error("Failed to create tag:", error);
    }
  };

  const handleColorChange = async (id: number, color: string) => {
    try {
      await fetch(`${getApiBase()}/tags/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ color }),
      });
      await onChanged();
    } catch (error) {
      logger.error("Failed to update tag color:", error);
    }
  };

  const handleSaveTag = async (id: number) => {
    const name = editingTagName.trim();
    if (!name) return;
    try {
      await fetch(`${getApiBase()}/tags/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, color: editingTagColor }),
      });
      setEditingTagId(null);
      await onChanged();
    } catch (error) {
      logger.error("Failed to update tag:", error);
    }
  };

  const handleDeleteTag = async (id: number) => {
    try {
      await fetch(`${getApiBase()}/tags/${id}`, { method: "DELETE" });
      await onChanged();
    } catch (error) {
      logger.error("Failed to delete tag:", error);
    }
  };

  const handleResetToDefault = async () => {
    if (!confirm(t("tagManagement.resetConfirm"))) return;
    try {
      await resetTagsToDefault(mode);
      await onChanged();
    } catch (error) {
      logger.error("Failed to reset tags:", error);
    }
  };

  const startEditing = (tag: TagRow) => {
    setEditingTagId(tag.id);
    setEditingTagName(tag.name);
    setEditingTagColor(tag.color);
  };

  return (
    <div className="space-y-4 pt-4">
      {/* Add new tag */}
      <div className="flex items-center gap-2">
        <ColorPicker color={newTagColor} onChange={setNewTagColor} />
        <Input
          placeholder={t("tagManagement.newTag.placeholder")}
          value={newTagName}
          onChange={(e) => setNewTagName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCreateTag()}
          className="max-w-xs"
        />
        <Button
          variant="outline"
          size="icon"
          onClick={handleCreateTag}
          disabled={!newTagName.trim()}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <Separator />

      {/* Tag list */}
      <div className="space-y-2">
        {tags.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {t("tagManagement.empty")}
          </p>
        )}
        {tags.map((tag) => (
          <div
            key={tag.id}
            className="flex items-center gap-2 p-2 rounded-md hover:bg-muted/50"
          >
            {editingTagId === tag.id ?
              <>
                <ColorPicker
                  color={editingTagColor}
                  onChange={setEditingTagColor}
                />
                <Input
                  value={editingTagName}
                  onChange={(e) => setEditingTagName(e.target.value)}
                  onKeyDown={(e) =>
                    e.key === "Enter" && handleSaveTag(tag.id)
                  }
                  className="h-8 max-w-xs"
                  autoFocus
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => handleSaveTag(tag.id)}
                >
                  <Check className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setEditingTagId(null)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </>
            : <>
                <ColorPicker
                  color={tag.color}
                  onChange={(color) => handleColorChange(tag.id, color)}
                />
                <span className="flex-1 text-sm">{tag.name}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => startEditing(tag)}
                >
                  <Pencil className="h-3 w-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  onClick={() => handleDeleteTag(tag.id)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </>
            }
          </div>
        ))}
      </div>

      <Separator />

      {/* Reset to default */}
      <div className="flex justify-end">
        <Button
          variant="outline"
          className="gap-2 text-destructive hover:text-destructive"
          onClick={handleResetToDefault}
        >
          <RotateCcw className="h-4 w-4" />
          {t("tagManagement.resetToDefault")}
        </Button>
      </div>
    </div>
  );
}
