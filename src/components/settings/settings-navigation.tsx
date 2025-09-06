import { Cloud, Bot, Code, Info } from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { useUiStore, type SettingsSection } from "@/stores/uiStore";

interface NavigationItem {
  id: SettingsSection;
  label: string;
  icon: React.ElementType;
}

const navigationItems: (NavigationItem | "separator")[] = [
  {
    id: "providers",
    label: "Providers",
    icon: Cloud,
  },
  {
    id: "models",
    label: "Models",
    icon: Bot,
  },
  "separator",
  {
    id: "development",
    label: "Development",
    icon: Code,
  },
  {
    id: "about",
    label: "About",
    icon: Info,
  },
];

export function SettingsNavigation() {
  const { activeSettingsSection, setActiveSettingsSection } = useUiStore();

  return (
    <>
      <SidebarGroup>
        <SidebarGroupLabel>Settings</SidebarGroupLabel>
        <SidebarMenu>
          {navigationItems.map((item, index) => {
            if (item === "separator") {
              return <SidebarSeparator key={`separator-${index}`} className="my-2" />;
            }

            const Icon = item.icon;
            const isActive = activeSettingsSection === item.id;

            return (
              <SidebarMenuItem key={item.id}>
                <SidebarMenuButton
                  onClick={() => setActiveSettingsSection(item.id)}
                  isActive={isActive}
                >
                  <Icon />
                  <span>{item.label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroup>
    </>
  );
}