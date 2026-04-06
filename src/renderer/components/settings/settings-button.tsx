import { SidebarMenuButton } from "@/components/ui/sidebar";
import { Settings2 } from "lucide-react";
import { useUiStore } from "@/stores/uiStore";
import { useTranslation } from "react-i18next";

export function SettingsButton() {
  const { showSettings, setShowSettings } = useUiStore();
  const { t } = useTranslation("common");

  return (
    <SidebarMenuButton
      onClick={() => setShowSettings(!showSettings)}
      isActive={showSettings}
    >
      <Settings2 />
      <span>{t("settings.navLabel")}</span>
    </SidebarMenuButton>
  );
}
