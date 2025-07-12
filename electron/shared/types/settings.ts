/**
 * Settings-related types shared between main and renderer processes
 */

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

export interface TestConnectionConfig {
  apiUrl: string;
  apiKey: string;
  model: string;
}

export interface TestConnectionResult {
  success: boolean;
  error?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}