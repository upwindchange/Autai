import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useTranslation } from "react-i18next";
import { ModelList } from "./model-list";
import type { ModelConfig, ProviderConfig } from "@shared";

interface ModelRoleSelectorProps {
  label: string;
  description?: string;
  value: ModelConfig;
  providers: ProviderConfig[];
  onChange: (config: ModelConfig) => void;
}

export function ModelRoleSelector({
  label,
  description,
  value,
  providers,
  onChange,
}: ModelRoleSelectorProps) {
  const { t } = useTranslation("providers");

  const handleProviderSelect = (providerId: string) => {
    const provider = providers.find((p) => p.id === providerId);
    if (provider) {
      onChange({
        ...value,
        providerId: provider.id,
        providerName: provider.name,
        modelName: "",
      });
    }
  };

  const handleModelSelect = (modelName: string) => {
    onChange({
      ...value,
      modelName,
    });
  };

  const selectedProvider = providers.find((p) => p.id === value.providerId);

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
          {providers.map((provider) => (
            <SelectItem key={provider.id} value={provider.id}>
              {provider.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {selectedProvider && (
        <ModelList
          provider={selectedProvider}
          selectedModel={value.modelName}
          onModelSelect={handleModelSelect}
        />
      )}
    </div>
  );
}
