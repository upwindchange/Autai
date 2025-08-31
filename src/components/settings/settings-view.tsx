import { SettingsForm } from "./settings-form";
import { useSettings } from "./settings-context";
import { ViewDebugTools } from "@/components/debug/view-debug-tools";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import type { EditingProvider } from "./types";

interface SettingsViewProps {
  onClose: () => void;
}

export function SettingsView({ onClose }: SettingsViewProps) {
  const { settings } = useSettings();
  const [editingProvider, setEditingProvider] =
    useState<EditingProvider | null>(null);

  // Check if debug tools are enabled
  const isDebugToolsEnabled = () => {
    const saved = localStorage.getItem("debugToolsEnabled");
    return saved ? JSON.parse(saved) : false;
  };

  return (
    <div className="absolute inset-0 flex flex-col bg-background">
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
          <h2 className="text-lg font-semibold">AI Settings</h2>
          <p className="text-sm text-muted-foreground">
            Configure your AI providers and model settings.
          </p>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto space-y-6">
          <SettingsForm 
            settings={settings} 
            onClose={onClose}
            editingProvider={editingProvider}
            setEditingProvider={setEditingProvider}
          />
          {isDebugToolsEnabled() && <ViewDebugTools />}
        </div>
      </div>
    </div>
  );
}
