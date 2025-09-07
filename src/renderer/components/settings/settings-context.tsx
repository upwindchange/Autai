import {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from "react";
import { SettingsContextType } from "./types";
import type { SettingsState, ProviderConfig } from "@shared";
import log from 'electron-log/renderer';

const logger = log.scope('SettingsContext');

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
      chat: { providerId: "", providerName: "", modelName: "", supportsAdvancedUsage: true },
      simple: { providerId: "", providerName: "", modelName: "", supportsAdvancedUsage: true },
      complex: { providerId: "", providerName: "", modelName: "", supportsAdvancedUsage: true },
    },
    useSameModelForAgents: true,
    logLevel: 'info',
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
      logger.error("failed to load settings", error);
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
          chat: {
            providerId: "default-openai",
            providerName: "Default OpenAI",
            modelName: "gpt-3.5-turbo",
            supportsAdvancedUsage: true,
          },
          simple: {
            providerId: "default-openai",
            providerName: "Default OpenAI",
            modelName: "gpt-3.5-turbo",
            supportsAdvancedUsage: true,
          },
          complex: {
            providerId: "default-openai",
            providerName: "Default OpenAI",
            modelName: "gpt-4",
            supportsAdvancedUsage: true,
          },
        },
        useSameModelForAgents: true,
        logLevel: 'info',
      };
      setSettings(defaultSettings);
    } finally {
      setIsLoading(false);
    }
  };

  const updateSettings = async (newSettings: SettingsState) => {
    // Check if log level changed
    if (newSettings.logLevel && newSettings.logLevel !== settings.logLevel) {
      // Apply log level change immediately
      await window.ipcRenderer.invoke("settings:updateLogLevel", newSettings.logLevel);
    }
    setSettings(newSettings);
    await window.ipcRenderer.invoke("settings:save", newSettings);
  };

  const addProvider = async (provider: ProviderConfig) => {
    const newSettings = {
      ...settings,
      providers: [...settings.providers, provider],
    };
    await updateSettings(newSettings);
  };

  const updateProvider = async (
    id: string,
    updates: Partial<ProviderConfig>
  ) => {
    const newSettings = {
      ...settings,
      providers: settings.providers.map((p) => {
        if (p.id !== id) return p;

        // Type-safe provider updates based on provider type
        if (p.provider === "openai-compatible") {
          return {
            ...p,
            ...(updates as Partial<
              Extract<ProviderConfig, { provider: "openai-compatible" }>
            >),
          };
        } else if (p.provider === "anthropic") {
          return {
            ...p,
            ...(updates as Partial<
              Extract<ProviderConfig, { provider: "anthropic" }>
            >),
          };
        }

        // This should never happen with proper typing, but we need to satisfy TS
        return p;
      }),
    };
    await updateSettings(newSettings);
  };

  const removeProvider = async (id: string) => {
    // Prevent removing all providers
    if (settings.providers.length <= 1) return;

    const newSettings = {
      ...settings,
      providers: settings.providers.filter((p) => p.id !== id),
    };

    // If we're removing a provider that's used in model configurations, reset those configurations
    const updatedModelConfigurations = { ...settings.modelConfigurations };
    if (settings.modelConfigurations.simple.providerId === id) {
      updatedModelConfigurations.simple = { providerId: "", providerName: "", modelName: "", supportsAdvancedUsage: true };
    }
    if (settings.modelConfigurations.complex.providerId === id) {
      updatedModelConfigurations.complex = { providerId: "", providerName: "", modelName: "", supportsAdvancedUsage: true };
    }

    newSettings.modelConfigurations = updatedModelConfigurations;

    await updateSettings(newSettings);
  };

  const updateModelConfiguration = async (
    modelType: "simple" | "complex",
    config: { providerId: string; modelName: string }
  ) => {
    const newSettings = {
      ...settings,
      modelConfigurations: {
        ...settings.modelConfigurations,
        [modelType]: config,
      },
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
