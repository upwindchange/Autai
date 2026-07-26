import { useState, useEffect, useMemo } from "react";
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
import { useProviderModels } from "@/hooks/useProviderModels";
import { ProviderCatalog } from "./provider-catalog";
import { ConfiguredProviderCard } from "./configured-provider-card";
import { ModelRoleSelector } from "./model-role-selector";
import {
  ModelParamsFields,
  type ModelParamsValue,
} from "./model-params-fields";
import type {
  ModelDefinition,
  ModelRole,
  ModelRoleAssignment,
  ProviderDefinition,
  ReasoningOption,
  SettingsState,
  UserProviderConfig,
} from "@shared";
import type { EditingProvider } from "../types";

interface ProvidersModelsSectionProps {
  settings: SettingsState;
}

/**
 * Resolve a model's `reasoningOptions` from the catalog by (providerDir, modelId).
 * The catalog is fetched per provider dir; for openai-compatible models with no
 * TOML entry, no reasoning controls render (the user has nothing to configure).
 */
function useReasoningOptions(
  providerDir: string | undefined,
  modelId: string | undefined,
): ReasoningOption[] | undefined {
  const { models } = useProviderModels(providerDir ?? null);
  return useMemo(() => {
    if (!providerDir || !modelId) return undefined;
    const def = models.find((m: ModelDefinition) => m.file === modelId);
    return def?.reasoningOptions;
  }, [models, providerDir, modelId]);
}

/**
 * Resolve the providerDir for a role's assignment by looking it up in the
 * configured providers list. Returns undefined if the role is unassigned or the
 * provider config has been removed.
 */
function providerDirForRole(
  assignment: ModelRoleAssignment,
  providers: UserProviderConfig[],
): string | undefined {
  if (!assignment.providerId) return undefined;
  return providers.find((p) => p.id === assignment.providerId)?.providerDir;
}

/**
 * Single state holder for one role's params draft. The role's ModelParamsFields
 * card owns its own draft + Save button (configured-provider-card pattern);
 * the parent's `handleSaveModelRoles` persists the model assignment separately.
 */
function useParamsDraft(initial: SettingsState, role: ModelRole) {
  const initialParams = initial.modelAssignments?.[role]?.params;
  const [draft, setDraft] = useState<ModelParamsValue>({
    systemPrompt: null,
    params: initialParams ?? null,
  });
  const [saving, setSaving] = useState(false);
  // Re-seed when the persisted params change externally (e.g. first load or
  // useSameModelForAgents mirroring).
  useEffect(() => {
    setDraft({
      systemPrompt: null,
      params: initial.modelAssignments?.[role]?.params ?? null,
    });
  }, [initial.modelAssignments, role]);
  return { draft, setDraft, saving, setSaving };
}

export function ProvidersModelsSection({
  settings,
}: ProvidersModelsSectionProps) {
  const { addProvider, updateProvider, removeProvider, updateSettings } =
    useSettings();
  const { t } = useTranslation("providers");
  const tt = useTranslation("threads").t;
  const { providers: catalogProviders } = useProviderCatalog();
  const [editingProviderId, setEditingProviderId] = useState<string | null>(
    null,
  );
  const [catalogOpen, setCatalogOpen] = useState(false);

  // Model role assignments
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

  // System-level chat defaults (moved here from threads-section): systemPrompt +
  // defaultModelParams apply to the chat role when a thread has no per-thread
  // override. Drafted locally, saved via updateSettings on the Save button.
  const [chatDefaultsDraft, setChatDefaultsDraft] = useState<ModelParamsValue>(
    () => ({
      systemPrompt: settings.systemPrompt ?? null,
      params: settings.defaultModelParams ?? null,
    }),
  );
  const [chatDefaultsSaving, setChatDefaultsSaving] = useState(false);

  // Per-role params drafts (sampling + reasoning selection). These persist into
  // model_assignments.params, which the backend now reads via complexModel() etc.
  const simpleParams = useParamsDraft(settings, "simple");
  const complexParams = useParamsDraft(settings, "complex");

  const providers = settings.providers || [];

  useEffect(() => {
    setChatModelConfig(settings.modelAssignments?.chat ?? chatModelConfig);
    setSimpleModelConfig(
      settings.modelAssignments?.simple ?? simpleModelConfig,
    );
    setComplexModelConfig(
      settings.modelAssignments?.complex ?? complexModelConfig,
    );
    setUseSameModelForAgents(settings.useSameModelForAgents ?? true);
    setChatDefaultsDraft({
      systemPrompt: settings.systemPrompt ?? null,
      params: settings.defaultModelParams ?? null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  // Resolve the catalog reasoning_options for the currently-selected models so
  // each params card renders the right thinking controls (or none). When
  // useSameModelForAgents is on, the agent's MODEL is the chat model (only the
  // params are the agent's own), so resolve reasoning options from chat.
  const effectiveSimple = useSameModelForAgents ? chatModelConfig : simpleModelConfig;
  const effectiveComplex = useSameModelForAgents ? chatModelConfig : complexModelConfig;
  const chatReasoning = useReasoningOptions(
    providerDirForRole(chatModelConfig, providers),
    chatModelConfig.modelId || undefined,
  );
  const simpleReasoning = useReasoningOptions(
    providerDirForRole(effectiveSimple, providers),
    effectiveSimple.modelId || undefined,
  );
  const complexReasoning = useReasoningOptions(
    providerDirForRole(effectiveComplex, providers),
    effectiveComplex.modelId || undefined,
  );

  // --- Provider CRUD ---
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

  // --- Role assignment save ---
  const handleSaveModelRoles = async () => {
    setIsSaving(true);
    try {
      await updateSettings({
        ...settings,
        modelAssignments: {
          chat: chatModelConfig,
          simple: {
            ...simpleModelConfig,
            params: simpleParams.draft.params ?? undefined,
          },
          complex: {
            ...complexModelConfig,
            params: complexParams.draft.params ?? undefined,
          },
        },
        useSameModelForAgents,
      });
    } finally {
      setIsSaving(false);
    }
  };

  // --- Chat defaults save (systemPrompt + defaultModelParams) ---
  const handleSaveChatDefaults = async () => {
    setChatDefaultsSaving(true);
    try {
      await updateSettings({
        ...settings,
        systemPrompt: chatDefaultsDraft.systemPrompt ?? "",
        defaultModelParams: chatDefaultsDraft.params ?? undefined,
      });
    } finally {
      setChatDefaultsSaving(false);
    }
  };

  // --- Per-role params save ---
  // Preserves the role's existing model identity (providerId/modelId) — only
  // the params change. When useSameModelForAgents is on, `settings` (from the
  // getter) already carries the mirrored chat model on the agent role, so we
  // spread from the persisted assignment rather than the (possibly-empty)
  // local selector state.
  const handleSaveSimpleParams = async () => {
    simpleParams.setSaving(true);
    try {
      const persisted = settings.modelAssignments?.simple;
      await updateSettings({
        ...settings,
        modelAssignments: {
          ...settings.modelAssignments,
          simple: {
            role: "simple",
            providerId: persisted?.providerId ?? simpleModelConfig.providerId,
            modelId: persisted?.modelId ?? simpleModelConfig.modelId,
            params: simpleParams.draft.params ?? undefined,
          },
        },
      });
    } finally {
      simpleParams.setSaving(false);
    }
  };
  const handleSaveComplexParams = async () => {
    complexParams.setSaving(true);
    try {
      const persisted = settings.modelAssignments?.complex;
      await updateSettings({
        ...settings,
        modelAssignments: {
          ...settings.modelAssignments,
          complex: {
            role: "complex",
            providerId: persisted?.providerId ?? complexModelConfig.providerId,
            modelId: persisted?.modelId ?? complexModelConfig.modelId,
            params: complexParams.draft.params ?? undefined,
          },
        },
      });
    } finally {
      complexParams.setSaving(false);
    }
  };

  // Determine which roles a provider is assigned to (display badges).
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

  const getDefinition = (dir: string): ProviderDefinition | undefined =>
    catalogProviders.find((p) => p.dir === dir);

  if (catalogOpen) {
    return (
      <ProviderCatalog
        onSelect={handleSelectFromCatalog}
        onBack={() => setCatalogOpen(false)}
      />
    );
  }

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

      {/* Model Roles + params — only meaningful once a provider is configured. */}
      {providers.length > 0 && (
        <>
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

          {/* Chat defaults — system-level systemPrompt + defaultModelParams for
              the chat role. Moved here from threads-section so all model/param
              configuration lives under one section. */}
          <Card>
            <CardHeader>
              <CardTitle>{tt("defaultChatParams.title")}</CardTitle>
              <CardDescription>
                {tt("defaultChatParams.description")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ModelParamsFields
                value={chatDefaultsDraft}
                onChange={setChatDefaultsDraft}
                systemPromptPlaceholder={tt(
                  "defaultChatParams.systemPromptEmpty",
                )}
                i18nNamespace="threads"
                keyPrefix="defaultChatParams"
                reasoningOptions={chatReasoning}
              />
              <div className="flex justify-end pt-1">
                <Button
                  onClick={handleSaveChatDefaults}
                  disabled={chatDefaultsSaving}
                >
                  {chatDefaultsSaving ?
                    <Loader2 className="size-4 animate-spin" />
                  : tt("defaultChatParams.save")}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Per-agent params — always shown, regardless of useSameModelForAgents.
              The MODEL may be shared with chat when that toggle is on, but each
              agent role keeps its OWN sampling + reasoning config. Reasoning
              controls are driven by the effective model's catalog entry. */}
          <Card>
            <CardHeader>
              <CardTitle>{t("params.simple.title")}</CardTitle>
              <CardDescription>
                {t("params.simple.description")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ModelParamsFields
                value={simpleParams.draft}
                onChange={simpleParams.setDraft}
                i18nNamespace="providers"
                keyPrefix="params"
                reasoningOptions={simpleReasoning}
                hideSystemPrompt
              />
              <div className="flex justify-end pt-1">
                <Button
                  onClick={handleSaveSimpleParams}
                  disabled={simpleParams.saving}
                >
                  {simpleParams.saving ?
                    <Loader2 className="size-4 animate-spin" />
                  : t("params.save")}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("params.complex.title")}</CardTitle>
              <CardDescription>
                {t("params.complex.description")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ModelParamsFields
                value={complexParams.draft}
                onChange={complexParams.setDraft}
                i18nNamespace="providers"
                keyPrefix="params"
                reasoningOptions={complexReasoning}
                hideSystemPrompt
              />
              <div className="flex justify-end pt-1">
                <Button
                  onClick={handleSaveComplexParams}
                  disabled={complexParams.saving}
                >
                  {complexParams.saving ?
                    <Loader2 className="size-4 animate-spin" />
                  : t("params.save")}
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
