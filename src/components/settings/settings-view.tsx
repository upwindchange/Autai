import { SettingsForm } from "./settings-form";
import { ProfileSelector } from "./profile-selector";
import { useSettings } from "./settings-context";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SettingsViewProps {
  onClose: () => void;
}

export function SettingsView({ onClose }: SettingsViewProps) {
  const { activeProfile } = useSettings();

  return (
    <div className="absolute inset-0 flex flex-col bg-background">
      <div className="flex items-center gap-2 p-4 border-b">
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="h-8 w-8"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h2 className="text-lg font-semibold">AI Settings</h2>
          <p className="text-sm text-muted-foreground">
            Configure your AI model settings and API endpoints.
          </p>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto space-y-6">
          <ProfileSelector />
          {activeProfile && (
            <SettingsForm
              profile={activeProfile}
              onClose={onClose}
            />
          )}
        </div>
      </div>
    </div>
  );
}