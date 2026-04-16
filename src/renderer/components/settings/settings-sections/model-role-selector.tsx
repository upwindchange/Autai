import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useTranslation } from "react-i18next";
import { TomlModelList } from "./toml-model-list";
import type {
  ModelRoleAssignment,
  UserProviderConfig,
  ProviderDefinition,
} from "@shared";

const API_BASE = "http://localhost:3001";

interface ModelRoleSelectorProps {
  label: string;
  description?: string;
  value: ModelRoleAssignment;
  providers: UserProviderConfig[];
  catalogProviders: ProviderDefinition[];
  onChange: (config: ModelRoleAssignment) => void;
}

export function ModelRoleSelector({
  label,
  description,
  value,
  providers,
  catalogProviders,
  onChange,
}: ModelRoleSelectorProps) {
  const { t } = useTranslation("providers");

  const handleProviderSelect = (providerId: string) => {
    onChange({
      ...value,
      providerId,
      modelFile: "",
    });
  };

  const handleModelSelect = (modelFile: string) => {
    onChange({
      ...value,
      modelFile,
    });
  };

  const selectedProvider = providers.find((p) => p.id === value.providerId);
  const selectedDefinition =
    selectedProvider ?
      catalogProviders.find((d) => d.dir === selectedProvider.providerDir)
    : undefined;

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-sm font-medium">{label}</Label>
        {description && (
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        )}
      </div>

      <Select value={value.providerId} onValueChange={handleProviderSelect}>
        <SelectTrigger>
          <SelectValue placeholder={t("roleSelector.placeholder")} />
        </SelectTrigger>
        <SelectContent>
          {providers.map((provider) => {
            const def = catalogProviders.find(
              (d) => d.dir === provider.providerDir,
            );
            return (
              <SelectItem key={provider.id} value={provider.id}>
                <div className="flex items-center gap-2">
                  {def?.logo && (
                    <span
                      className="h-4 w-4 shrink-0 text-foreground [&_svg]:h-full [&_svg]:w-full"
                      dangerouslySetInnerHTML={{ __html: def.logo }}
                    />
                  )}
                  {def?.name || provider.providerDir}
                </div>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>

      {selectedProvider && (
        <TomlModelList
          providerDir={selectedProvider.providerDir}
          selectedModel={value.modelFile}
          onModelSelect={handleModelSelect}
        />
      )}
    </div>
  );
}
