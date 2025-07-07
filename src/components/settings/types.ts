export interface AISettings {
  apiUrl: string;
  apiKey: string;
  complexModel: string;
  simpleModel: string;
}

export interface SettingsProfile {
  id: string;
  name: string;
  settings: AISettings;
  createdAt: Date;
  updatedAt: Date;
}

export interface SettingsState {
  profiles: SettingsProfile[];
  activeProfileId: string;
}

export interface SettingsContextType {
  profiles: SettingsProfile[];
  activeProfile: SettingsProfile | null;
  createProfile: (name: string, settings: AISettings) => Promise<void>;
  updateProfile: (id: string, updates: Partial<SettingsProfile>) => Promise<void>;
  deleteProfile: (id: string) => Promise<void>;
  setActiveProfile: (id: string) => Promise<void>;
  isLoading: boolean;
}