import { SidebarMenuButton } from "@/components/ui/sidebar";
import { Settings2 } from "lucide-react";
import { useUiStore } from "@/stores/uiStore";

export function SettingsButton() {
  const { showSettings, setShowSettings } = useUiStore();

  return (
    <SidebarMenuButton 
      onClick={() => setShowSettings(!showSettings)}
      isActive={showSettings}
    >
      <Settings2 />
      <span>Settings</span>
    </SidebarMenuButton>
  );
}