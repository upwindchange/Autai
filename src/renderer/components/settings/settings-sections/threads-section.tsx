import { useState, useEffect, useCallback } from "react";
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
import { X, Pencil, Check, Plus } from "lucide-react";
import { useSettings } from "@/components/settings";
import { useTranslation } from "react-i18next";
import type { SettingsState } from "@shared";
import type { TagRow } from "@shared/tag";
import log from "electron-log/renderer";

const API_BASE = "http://localhost:3001";

const logger = log.scope("ThreadsSection");

interface ThreadsSectionProps {
  settings: SettingsState;
}

export function ThreadsSection({ settings }: ThreadsSectionProps) {
  const { updateSettings } = useSettings();
  const { t } = useTranslation("threads");
  const [tags, setTags] = useState<TagRow[]>([]);
  const [newTagName, setNewTagName] = useState("");
  const [editingTagId, setEditingTagId] = useState<number | null>(null);
  const [editingTagName, setEditingTagName] = useState("");

  useEffect(() => {
    loadTags();
  }, []);

  const loadTags = async () => {
    try {
      const res = await fetch(`${API_BASE}/tags`);
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

  const handleCreateTag = useCallback(async () => {
    const name = newTagName.trim();
    if (!name) return;
    try {
      await fetch(`${API_BASE}/tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      setNewTagName("");
      await loadTags();
    } catch (error) {
      logger.error("Failed to create tag:", error);
    }
  }, [newTagName]);

  const handleRenameTag = async (id: number) => {
    const name = editingTagName.trim();
    if (!name) return;
    try {
      await fetch(`${API_BASE}/tags/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      setEditingTagId(null);
      await loadTags();
    } catch (error) {
      logger.error("Failed to rename tag:", error);
    }
  };

  const handleDeleteTag = async (id: number) => {
    try {
      await fetch(`${API_BASE}/tags/${id}`, { method: "DELETE" });
      await loadTags();
    } catch (error) {
      logger.error("Failed to delete tag:", error);
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
          <CardTitle>{t("tagManagement.title")}</CardTitle>
          <CardDescription>{t("tagManagement.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Add new tag */}
          <div className="flex items-center gap-2">
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
                    <Input
                      value={editingTagName}
                      onChange={(e) => setEditingTagName(e.target.value)}
                      onKeyDown={(e) =>
                        e.key === "Enter" && handleRenameTag(tag.id)
                      }
                      className="h-8 max-w-xs"
                      autoFocus
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => handleRenameTag(tag.id)}
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
                    <span className="flex-1 text-sm">{tag.name}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => {
                        setEditingTagId(tag.id);
                        setEditingTagName(tag.name);
                      }}
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
        </CardContent>
      </Card>
    </div>
  );
}
