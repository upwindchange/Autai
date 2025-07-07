import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { SettingsContextType, SettingsProfile, AISettings } from "./types";

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
  const [profiles, setProfiles] = useState<SettingsProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);

  const activeProfile = profiles.find((p) => p.id === activeProfileId) || null;

  // Load settings on mount
  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const settings = await window.ipcRenderer.invoke("settings:load");
      setProfiles(settings.profiles);
      setActiveProfileId(settings.activeProfileId);
    } catch (error) {
      console.error("Failed to load settings:", error);
      // Create default profile if none exists
      const defaultProfile: SettingsProfile = {
        id: "default",
        name: "Default",
        settings: {
          apiUrl: "https://api.openai.com/v1",
          apiKey: "",
          complexModel: "gpt-4",
          simpleModel: "gpt-3.5-turbo",
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      setProfiles([defaultProfile]);
      setActiveProfileId(defaultProfile.id);
    } finally {
      setIsLoading(false);
    }
  };

  const createProfile = async (name: string, settings: AISettings) => {
    const newProfile: SettingsProfile = {
      id: `profile-${Date.now()}`,
      name,
      settings,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const updatedProfiles = [...profiles, newProfile];
    setProfiles(updatedProfiles);
    setActiveProfileId(newProfile.id);

    await window.ipcRenderer.invoke("settings:save", {
      profiles: updatedProfiles,
      activeProfileId: newProfile.id,
    });
  };

  const updateProfile = async (id: string, updates: Partial<SettingsProfile>) => {
    const updatedProfiles = profiles.map((p) =>
      p.id === id ? { ...p, ...updates } : p
    );
    setProfiles(updatedProfiles);

    await window.ipcRenderer.invoke("settings:save", {
      profiles: updatedProfiles,
      activeProfileId,
    });
  };

  const deleteProfile = async (id: string) => {
    if (profiles.length <= 1) return;

    const updatedProfiles = profiles.filter((p) => p.id !== id);
    setProfiles(updatedProfiles);

    // If deleting active profile, switch to first available
    let newActiveId = activeProfileId;
    if (activeProfileId === id) {
      newActiveId = updatedProfiles[0].id;
      setActiveProfileId(newActiveId);
    }

    await window.ipcRenderer.invoke("settings:save", {
      profiles: updatedProfiles,
      activeProfileId: newActiveId,
    });
  };

  const setActiveProfile = async (id: string) => {
    setActiveProfileId(id);
    await window.ipcRenderer.invoke("settings:save", {
      profiles,
      activeProfileId: id,
    });
  };

  return (
    <SettingsContext.Provider
      value={{
        profiles,
        activeProfile,
        createProfile,
        updateProfile,
        deleteProfile,
        setActiveProfile,
        isLoading,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}