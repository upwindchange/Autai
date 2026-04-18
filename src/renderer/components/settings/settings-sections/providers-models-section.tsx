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
import { Plus, Save, Loader2 } from "lucide-react";
import { useSettings } from "@/components/settings";
import { useTranslation } from "react-i18next";
import { useProviderCatalog } from "@/hooks/useProviderCatalog";
import { ProviderCatalog } from "./provider-catalog";
import { ConfiguredProviderCard } from "./configured-provider-card";
import { ModelRoleSelector } from "./model-role-selector";
import type {
  SettingsState,
  UserProviderConfig,
  ProviderDefinition,
  ModelRoleAssignment,
} from "@shared";
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
  const { providers: catalogProviders } = useProviderCatalog();
  const [editingProviderId, setEditingProviderId] = useState<string | null>(
    null,
  );
  const [catalogOpen, setCatalogOpen] = useState(false);

  // Model role state
  const [chatModelConfig, setChatModelConfig] = useState<ModelRoleAssignment>({
    role: "chat",
    providerId: "",
    modelId: "",
  });
  const [simpleModelConfig, setSimpleModelConfig] =
    useState<ModelRoleAssignment>({
      role: "simple",
      providerId: "",
      modelId: "",
    });
  const [complexModelConfig, setComplexModelConfig] =
    useState<ModelRoleAssignment>({
      role: "complex",
      providerId: "",
      modelId: "",
    });
  const [useSameModelForAgents, setUseSameModelForAgents] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Sync from settings
  useEffect(() => {
    if (settings?.modelAssignments?.chat) {
      setChatModelConfig(settings.modelAssignments.chat);
    }
    if (settings?.modelAssignments?.simple) {
      setSimpleModelConfig(settings.modelAssignments.simple);
    }
    if (settings?.modelAssignments?.complex) {
      setComplexModelConfig(settings.modelAssignments.complex);
    }
    if (settings?.useSameModelForAgents !== undefined) {
      setUseSameModelForAgents(settings.useSameModelForAgents);
    }
  }, [settings]);

  // Provider CRUD
  const handleSelectFromCatalog = (provider: ProviderDefinition) => {
    const newId = `provider-${Date.now()}`;
    const newProvider: EditingProvider = {
      id: newId,
      providerDir: provider.dir,
      apiKey: "",
      npm: provider.npm,
      ...(provider.api && { defaultApiUrl: provider.api }),
      isNew: true,
    };
    addProvider(newProvider);
    setEditingProviderId(newId);
    setCatalogOpen(false);
  };

  const handleSaveProvider = async (provider: UserProviderConfig) => {
    await updateProvider(provider.id, provider);
    setEditingProviderId(null);
  };

  const handleDeleteProvider = async (id: string) => {
    await removeProvider(id);
  };

  const handleCancelEdit = () => {
    setEditingProviderId(null);
  };

  // Model roles save
  const handleSaveModelRoles = async () => {
    setIsSaving(true);
    try {
      await updateSettings({
        ...settings,
        modelAssignments: {
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
    if (settings?.modelAssignments?.chat?.providerId === providerId) {
      roles.push("Chat");
    }
    if (!settings?.useSameModelForAgents) {
      if (settings?.modelAssignments?.simple?.providerId === providerId) {
        roles.push("Simple");
      }
      if (settings?.modelAssignments?.complex?.providerId === providerId) {
        roles.push("Complex");
      }
    }
    return roles;
  };

  // Lookup provider definition from catalog
  const getDefinition = (dir: string): ProviderDefinition | undefined =>
    catalogProviders.find((p) => p.dir === dir);

  const providers = settings?.providers || [];

  return (
    <div className="space-y-6">
      {/* Section Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">{t("title")}</h2>
          <p className="text-muted-foreground mt-1">{t("subtitle")}</p>
        </div>
        <Button onClick={() => setCatalogOpen(true)} size="sm">
          <Plus className="h-4 w-4 mr-2" />
          {t("btn.addProvider")}
        </Button>
      </div>

      {/* Provider Catalog Dialog */}
      <ProviderCatalog
        open={catalogOpen}
        onOpenChange={setCatalogOpen}
        onSelect={handleSelectFromCatalog}
      />

      {/* Configured providers */}
      {providers.map((provider) => {
        const definition = getDefinition(provider.providerDir);
        if (!definition) return null;

        return (
          <ConfiguredProviderCard
            key={provider.id}
            provider={provider}
            definition={definition}
            isEditing={editingProviderId === provider.id}
            assignedRoles={getAssignedRoles(provider.id)}
            onEdit={() => setEditingProviderId(provider.id)}
            onCancel={handleCancelEdit}
            onSave={handleSaveProvider}
            onDelete={() => handleDeleteProvider(provider.id)}
          />
        );
      })}

      {/* Model Roles Card */}
      {providers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t("roles.title")}</CardTitle>
            <CardDescription>{t("roles.description")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <ModelRoleSelector
              label={t("roles.chat.label")}
              description={t("roles.chat.description")}
              value={chatModelConfig}
              providers={providers}
              catalogProviders={catalogProviders}
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
                  catalogProviders={catalogProviders}
                  onChange={setSimpleModelConfig}
                />

                <ModelRoleSelector
                  label={t("roles.complex.label")}
                  description={t("roles.complex.description")}
                  value={complexModelConfig}
                  providers={providers}
                  catalogProviders={catalogProviders}
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
