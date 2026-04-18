import {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from "react";
import { SettingsContextType } from "./types";
import type { SettingsState, UserProviderConfig } from "@shared";
import { getDefaultSettings } from "@shared";
import log from "electron-log/renderer";

const logger = log.scope("SettingsContext");

const API_BASE = "http://localhost:3001";

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
  const [settings, setSettings] = useState<SettingsState>(getDefaultSettings());
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const res = await fetch(`${API_BASE}/settings`);
      const loadedSettings = (await res.json()) as SettingsState;
      setSettings(loadedSettings);
    } catch (error) {
      logger.error("failed to load settings", error);
      setSettings(getDefaultSettings());
    } finally {
      setIsLoading(false);
    }
  };

  const updateSettings = async (newSettings: SettingsState) => {
    setSettings(newSettings);
    await fetch(`${API_BASE}/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newSettings),
    });
  };

  const addProvider = async (provider: UserProviderConfig) => {
    const newSettings = {
      ...settings,
      providers: [...settings.providers, provider],
    };
    await updateSettings(newSettings);
  };

  const updateProvider = async (
    id: string,
    updates: Partial<UserProviderConfig>,
  ) => {
    const newSettings = {
      ...settings,
      providers: settings.providers.map((p) =>
        p.id === id ? { ...p, ...updates } : p,
      ),
    };
    await updateSettings(newSettings);
  };

  const removeProvider = async (id: string) => {
    const newSettings = {
      ...settings,
      providers: settings.providers.filter((p) => p.id !== id),
    };

    // Reset model assignments that reference the removed provider
    const updatedAssignments = { ...settings.modelAssignments };
    for (const role of ["chat", "simple", "complex"] as const) {
      if (updatedAssignments[role].providerId === id) {
        const firstProvider = newSettings.providers[0];
        updatedAssignments[role] = {
          ...updatedAssignments[role],
          providerId: firstProvider?.id || "",
          modelId: "",
        };
      }
    }
    newSettings.modelAssignments = updatedAssignments;

    await updateSettings(newSettings);
  };

  const updateModelConfiguration = async (
    modelType: "simple" | "complex",
    config: { providerId: string; modelId: string },
  ) => {
    const newSettings = {
      ...settings,
      modelAssignments: {
        ...settings.modelAssignments,
        [modelType]: {
          ...settings.modelAssignments[modelType],
          ...config,
        },
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
