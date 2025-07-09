/**
 * Configuration for AI model connection
 */
export interface AISettings {
  apiUrl: string;
  apiKey: string;
  complexModel: string;
  simpleModel: string;
}

/**
 * Individual settings profile that can be switched between
 */
export interface SettingsProfile {
  id: string;
  name: string;
  settings: AISettings;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Global settings state structure
 */
export interface SettingsState {
  profiles: SettingsProfile[];
  activeProfileId: string;
}

/**
 * Settings context API exposed to components
 */
export interface SettingsContextType {
  profiles: SettingsProfile[];
  activeProfile: SettingsProfile | null;
  createProfile: (name: string, settings: AISettings) => Promise<void>;
  updateProfile: (id: string, updates: Partial<SettingsProfile>) => Promise<void>;
  deleteProfile: (id: string) => Promise<void>;
  setActiveProfile: (id: string) => Promise<void>;
  isLoading: boolean;
}