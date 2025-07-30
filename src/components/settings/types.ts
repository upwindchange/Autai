import type { SettingsProfile, AISettings } from '@shared/settings';

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