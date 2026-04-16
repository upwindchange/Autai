import type { UserProviderConfig, SettingsState } from "@shared";

export interface EditingProvider extends UserProviderConfig {
  isNew?: boolean;
}

export type SectionType = "providers" | "development" | "about";

export interface SettingsContextType {
  settings: SettingsState;
  updateSettings: (newSettings: SettingsState) => Promise<void>;
  addProvider: (provider: UserProviderConfig) => Promise<void>;
  updateProvider: (
    id: string,
    updates: Partial<UserProviderConfig>,
  ) => Promise<void>;
  removeProvider: (id: string) => Promise<void>;
  updateModelConfiguration: (
    modelType: "simple" | "complex",
    config: { providerId: string; modelFile: string },
  ) => Promise<void>;
  isLoading: boolean;
}
