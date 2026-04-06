import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useSettings } from "@/components/settings";
import { useUiStore } from "@/stores/uiStore";
import { ProvidersModelsSection } from "@/components/settings/settings-sections";
import { DevelopmentSection } from "@/components/settings/settings-sections";
import { AboutSection } from "@/components/settings/settings-sections";
import { useTranslation } from "react-i18next";

interface SettingsViewProps {
  onClose: () => void;
}

export function SettingsView({ onClose }: SettingsViewProps) {
  const { settings } = useSettings();
  const { activeSettingsSection } = useUiStore();
  const { t } = useTranslation("settings");

  // Render the active section
  const renderSection = () => {
    switch (activeSettingsSection) {
      case "providers":
        return <ProvidersModelsSection settings={settings} />;
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
          onClick={onClose}
          className="h-8 w-8"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h2 className="text-lg font-semibold">{t("view.title")}</h2>
          <p className="text-sm text-muted-foreground">
            {t(`view.description.${activeSettingsSection}`)}
          </p>
        </div>
      </div>

      {/* Content Area - No sidebar here anymore */}
      <ScrollArea className="flex-1 overflow-hidden">
        <div className="p-6 h-full">
          <div className="max-w-3xl mx-auto">{renderSection()}</div>
        </div>
      </ScrollArea>
    </div>
  );
}
