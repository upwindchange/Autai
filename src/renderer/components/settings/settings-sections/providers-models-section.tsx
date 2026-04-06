import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Plus, Save, Loader2, Cloud } from "lucide-react";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { useSettings } from "@/components/settings";
import { useTranslation } from "react-i18next";
import { ProviderCard } from "./provider-card";
import { ModelRoleSelector } from "./model-role-selector";
import type { SettingsState, ModelConfig, ProviderType } from "@shared";
import { getDefaultProvider } from "@shared";
import type { EditingProvider } from "../types";

interface ProvidersModelsSectionProps {
  settings: SettingsState;
}

export function ProvidersModelsSection({
  settings,
}: ProvidersModelsSectionProps) {
  const { addProvider, updateProvider, removeProvider, updateSettings } =
    useSettings();
  const { t } = useTranslation("providers");
  const [editingProviderId, setEditingProviderId] = useState<string | null>(
    null,
  );

  // Model role state
  const [chatModelConfig, setChatModelConfig] = useState<ModelConfig>({
    providerId: "",
    providerName: "",
    modelName: "",
    supportsAdvancedUsage: true,
  });
  const [simpleModelConfig, setSimpleModelConfig] = useState<ModelConfig>({
    providerId: "",
    providerName: "",
    modelName: "",
    supportsAdvancedUsage: true,
  });
  const [complexModelConfig, setComplexModelConfig] = useState<ModelConfig>({
    providerId: "",
    providerName: "",
    modelName: "",
    supportsAdvancedUsage: true,
  });
  const [useSameModelForAgents, setUseSameModelForAgents] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Sync from settings
  useEffect(() => {
    if (settings?.modelConfigurations?.chat) {
      setChatModelConfig(settings.modelConfigurations.chat);
    }
    if (settings?.modelConfigurations?.simple) {
      setSimpleModelConfig(settings.modelConfigurations.simple);
    }
    if (settings?.modelConfigurations?.complex) {
      setComplexModelConfig(settings.modelConfigurations.complex);
    }
    if (settings?.useSameModelForAgents !== undefined) {
      setUseSameModelForAgents(settings.useSameModelForAgents);
    }
  }, [settings]);

  // Provider CRUD
  const handleAddProvider = (preselectedType?: ProviderType) => {
    const type = preselectedType || "openai-compatible";
    const newId = `provider-${Date.now()}`;
    const defaults = getDefaultProvider(type);
    const newProvider: EditingProvider = {
      ...defaults,
      id: newId,
      name: defaults.name,
      isNew: true,
    };
    // We'll handle the actual save in the card's onSave
    setEditingProviderId(newId);
    // Temporarily add a placeholder so the card can render in edit mode
    // We need a way to create the editing state without adding to providers yet
    // Instead, let's use a different approach: track "new provider" separately
    setNewProviderDraft(newProvider);
  };

  const [newProviderDraft, setNewProviderDraft] =
    useState<EditingProvider | null>(null);

  const handleSaveProvider = async (provider: EditingProvider) => {
    if (provider.isNew) {
      await addProvider(provider);
      setNewProviderDraft(null);
    } else {
      await updateProvider(provider.id, provider);
    }
    setEditingProviderId(null);
  };

  const handleDeleteProvider = async (id: string) => {
    await removeProvider(id);
  };

  const handleCancelEdit = () => {
    setEditingProviderId(null);
    setNewProviderDraft(null);
  };

  // Model roles save
  const handleSaveModelRoles = async () => {
    setIsSaving(true);
    try {
      await updateSettings({
        ...settings,
        modelConfigurations: {
          chat: chatModelConfig,
          simple: simpleModelConfig,
          complex: complexModelConfig,
        },
        useSameModelForAgents,
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Determine which roles a provider is assigned to
  const getAssignedRoles = (providerId: string): string[] => {
    const roles: string[] = [];
    if (settings?.modelConfigurations?.chat?.providerId === providerId) {
      roles.push("Chat");
    }
    if (!settings?.useSameModelForAgents) {
      if (settings?.modelConfigurations?.simple?.providerId === providerId) {
        roles.push("Simple");
      }
      if (settings?.modelConfigurations?.complex?.providerId === providerId) {
        roles.push("Complex");
      }
    }
    return roles;
  };

  const providers = settings?.providers || [];
  const isEmpty = providers.length === 0 && !newProviderDraft;

  return (
    <div className="space-y-6">
      {/* Section Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">{t("title")}</h2>
          <p className="text-muted-foreground mt-1">
            {t("subtitle")}
          </p>
        </div>
        {!isEmpty && (
          <Button onClick={() => handleAddProvider()} size="sm">
            <Plus className="h-4 w-4 mr-2" />
            {t("btn.addProvider")}
          </Button>
        )}
      </div>

      {/* Empty State */}
      {isEmpty && (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Cloud />
            </EmptyMedia>
            <EmptyTitle>{t("empty.title")}</EmptyTitle>
            <EmptyDescription>
              {t("empty.description")}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="flex-row flex-wrap justify-center">
            <Button
              variant="outline"
              onClick={() => handleAddProvider("openai-compatible")}
            >
              <Plus className="h-4 w-4 mr-2" />
              {t("btn.addOpenai")}
            </Button>
            <Button
              variant="outline"
              onClick={() => handleAddProvider("anthropic")}
            >
              <Plus className="h-4 w-4 mr-2" />
              {t("btn.addAnthropic")}
            </Button>
            <Button
              variant="outline"
              onClick={() => handleAddProvider("deepinfra")}
            >
              <Plus className="h-4 w-4 mr-2" />
              {t("btn.addDeepinfra")}
            </Button>
          </EmptyContent>
        </Empty>
      )}

      {/* New provider draft (being edited but not saved yet) */}
      {newProviderDraft && (
        <ProviderCard
          key={newProviderDraft.id}
          provider={newProviderDraft as SettingsState["providers"][number]}
          isEditing={true}
          isOnlyProvider={false}
          assignedRoles={[]}
          onEdit={() => {}}
          onCancel={handleCancelEdit}
          onSave={handleSaveProvider}
          onDelete={() => handleCancelEdit()}
        />
      )}

      {/* Existing providers */}
      {providers.map((provider) => (
        <ProviderCard
          key={provider.id}
          provider={provider}
          isEditing={editingProviderId === provider.id}
          isOnlyProvider={providers.length <= 1}
          assignedRoles={getAssignedRoles(provider.id)}
          onEdit={() => setEditingProviderId(provider.id)}
          onCancel={handleCancelEdit}
          onSave={async (updated: EditingProvider) => {
            await updateProvider(updated.id, updated);
            setEditingProviderId(null);
          }}
          onDelete={() => handleDeleteProvider(provider.id)}
        />
      ))}

      {/* Model Roles Card */}
      {providers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t("roles.title")}</CardTitle>
            <CardDescription>
              {t("roles.description")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <ModelRoleSelector
              label={t("roles.chat.label")}
              description={t("roles.chat.description")}
              value={chatModelConfig}
              providers={providers}
              onChange={setChatModelConfig}
            />

            <div className="flex items-center gap-2">
              <Switch
                id="use-same-model"
                checked={useSameModelForAgents}
                onCheckedChange={setUseSameModelForAgents}
              />
              <Label htmlFor="use-same-model" className="text-sm">
                {t("roles.useSameModel")}
              </Label>
            </div>

            {!useSameModelForAgents && (
              <>
                <ModelRoleSelector
                  label={t("roles.simple.label")}
                  description={t("roles.simple.description")}
                  value={simpleModelConfig}
                  providers={providers}
                  onChange={setSimpleModelConfig}
                />

                <ModelRoleSelector
                  label={t("roles.complex.label")}
                  description={t("roles.complex.description")}
                  value={complexModelConfig}
                  providers={providers}
                  onChange={setComplexModelConfig}
                />
              </>
            )}

            <div className="flex justify-end pt-2">
              <Button onClick={handleSaveModelRoles} disabled={isSaving}>
                {isSaving ?
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                : <Save className="h-4 w-4 mr-2" />}
                {t("btn.saveModelRoles")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
