import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { SettingsContextType } from "./types";
import type { SettingsState, ProviderConfig } from "@shared/index";

const SettingsContext = createContext<SettingsContextType | null>(null);

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error("useSettings must be used within a SettingsProvider");
  }
  return context;
}

interface SettingsProviderProps {
  children: ReactNode;
}

export function SettingsProvider({ children }: SettingsProviderProps) {
  const [settings, setSettings] = useState<SettingsState>({
    providers: [],
    modelConfigurations: {
      simple: { providerId: "", modelName: "" },
      complex: { providerId: "", modelName: "" }
    }
  });
  const [isLoading, setIsLoading] = useState(true);

  // Load settings on mount
  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const loadedSettings = await window.ipcRenderer.invoke("settings:load");
      setSettings(loadedSettings);
    } catch (error) {
      console.error("Failed to load settings:", error);
      // Create default settings if none exists
      const defaultSettings: SettingsState = {
        providers: [
          {
            id: "default-openai",
            name: "Default OpenAI",
            provider: "openai-compatible",
            apiUrl: "https://api.openai.com/v1",
            apiKey: "",
          },
        ],
        modelConfigurations: {
          simple: {
            providerId: "default-openai",
            modelName: "gpt-3.5-turbo",
          },
          complex: {
            providerId: "default-openai",
            modelName: "gpt-4",
          },
        },
      };
      setSettings(defaultSettings);
    } finally {
      setIsLoading(false);
    }
  };

  const updateSettings = async (newSettings: SettingsState) => {
    setSettings(newSettings);
    await window.ipcRenderer.invoke("settings:save", newSettings);
  };

  const addProvider = async (provider: ProviderConfig) => {
    const newSettings = {
      ...settings,
      providers: [...settings.providers, provider]
    };
    await updateSettings(newSettings);
  };

  const updateProvider = async (id: string, updates: Partial<ProviderConfig>) => {
    const newSettings = {
      ...settings,
      providers: settings.providers.map(p =>
        p.id === id ? { ...p, ...updates } : p
      )
    };
    await updateSettings(newSettings);
  };

  const removeProvider = async (id: string) => {
    // Prevent removing all providers
    if (settings.providers.length <= 1) return;

    const newSettings = {
      ...settings,
      providers: settings.providers.filter(p => p.id !== id)
    };
    
    // If we're removing a provider that's used in model configurations, reset those configurations
    let updatedModelConfigurations = { ...settings.modelConfigurations };
    if (settings.modelConfigurations.simple.providerId === id) {
      updatedModelConfigurations.simple = { providerId: "", modelName: "" };
    }
    if (settings.modelConfigurations.complex.providerId === id) {
      updatedModelConfigurations.complex = { providerId: "", modelName: "" };
    }
    
    newSettings.modelConfigurations = updatedModelConfigurations;
    
    await updateSettings(newSettings);
  };

  const updateModelConfiguration = async (modelType: "simple" | "complex", config: { providerId: string; modelName: string }) => {
    const newSettings = {
      ...settings,
      modelConfigurations: {
        ...settings.modelConfigurations,
        [modelType]: config
      }
    };
    await updateSettings(newSettings);
  };

  return (
    <SettingsContext.Provider
      value={{
        settings,
        updateSettings,
        addProvider,
        updateProvider,
        removeProvider,
        updateModelConfiguration,
        isLoading,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}