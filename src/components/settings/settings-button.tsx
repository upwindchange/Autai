import { SidebarMenuButton } from "@/components/ui/sidebar";
import { Settings2 } from "lucide-react";
import { useAppStore } from "@/store/appStore";

export function SettingsButton() {
  const { showSettings, setShowSettings } = useAppStore();

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