import type { ProviderConfig, SettingsState } from "@shared/index";

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
