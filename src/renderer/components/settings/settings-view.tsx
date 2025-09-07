import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useSettings } from "@/components/settings";
import { useUiStore } from "@/stores/uiStore";
import { ProvidersSection } from "@/components/settings/settings-sections";
import { ModelsSection } from "@/components/settings/settings-sections";
import { DevelopmentSection } from "@/components/settings/settings-sections";
import { AboutSection } from "@/components/settings/settings-sections";
import { SettingsForm } from "@/components/settings";
import type { EditingProvider } from "./types";

interface SettingsViewProps {
  onClose: () => void;
}

export function SettingsView({ onClose }: SettingsViewProps) {
  const { settings } = useSettings();
  const { activeSettingsSection } = useUiStore();
  const [editingProvider, setEditingProvider] =
    useState<EditingProvider | null>(null);

  // Render the active section
  const renderSection = () => {
    // If editing a provider, show the form
    if (editingProvider) {
      return (
        <SettingsForm
          settings={settings}
          onClose={() => setEditingProvider(null)}
          editingProvider={editingProvider}
          setEditingProvider={setEditingProvider}
        />
      );
    }

    switch (activeSettingsSection) {
      case "providers":
        return (
          <ProvidersSection
            settings={settings}
            editingProvider={editingProvider}
            setEditingProvider={setEditingProvider}
          />
        );
      case "models":
        return <ModelsSection settings={settings} />;
      case "development":
        return <DevelopmentSection settings={settings} />;
      case "about":
        return <AboutSection />;
      default:
        return null;
    }
  };

  return (
    <div className="absolute inset-0 flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center gap-2 p-4 border-b">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            if (editingProvider) {
              setEditingProvider(null); // Go back to provider list
            } else {
              onClose(); // Close settings view
            }
          }}
          className="h-8 w-8"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h2 className="text-lg font-semibold">Settings</h2>
          <p className="text-sm text-muted-foreground">
            {activeSettingsSection === "providers" &&
              "Manage AI provider configurations"}
            {activeSettingsSection === "models" &&
              "Configure AI models for different use cases"}
            {activeSettingsSection === "development" &&
              "Development tools and debugging options"}
            {activeSettingsSection === "about" &&
              "Application information and resources"}
          </p>
        </div>
      </div>

      {/* Content Area - No sidebar here anymore */}
      <ScrollArea className="flex-1">
        <div className="p-6">
          <div className="max-w-3xl mx-auto">{renderSection()}</div>
        </div>
      </ScrollArea>
    </div>
  );
}
