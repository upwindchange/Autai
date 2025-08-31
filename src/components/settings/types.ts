import type { ProviderConfig, SettingsState, OpenAICompatibleProviderConfig, AnthropicProviderConfig } from "@shared/index";

/**
 * Settings context API exposed to components
 */
export interface SettingsContextType {
  settings: SettingsState;
  updateSettings: (settings: SettingsState) => Promise<void>;
  addProvider: (provider: ProviderConfig) => Promise<void>;
  updateProvider: (
    id: string,
    updates: Partial<ProviderConfig>
  ) => Promise<void>;
  removeProvider: (id: string) => Promise<void>;
  updateModelConfiguration: (
    modelType: "simple" | "complex",
    config: { providerId: string; modelName: string }
  ) => Promise<void>;
  isLoading: boolean;
}

export type EditingProvider =
  | (OpenAICompatibleProviderConfig & { isNew?: boolean })
  | (AnthropicProviderConfig & { isNew?: boolean });
