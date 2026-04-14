import { Cloud, Code, Info, Tags } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { NavSecondary } from "@/components/side-bar/nav-secondary";
import { useUiStore, type SettingsSection } from "@/stores/uiStore";
import { useTranslation } from "react-i18next";
import type { ComponentProps } from "react";

interface NavigationItem {
  id: SettingsSection;
  labelKey: string;
  icon: React.ElementType;
}

const navigationItems: (NavigationItem | "separator")[] = [
  {
    id: "providers",
    labelKey: "sidebar.providers",
    icon: Cloud,
  },
  "separator",
  {
    id: "threads",
    labelKey: "sidebar.threads",
    icon: Tags,
  },
  {
    id: "development",
    labelKey: "sidebar.development",
    icon: Code,
  },
  {
    id: "about",
    labelKey: "sidebar.about",
    icon: Info,
  },
];

/**
 * Props for the SettingsSidebar component
 */
type SettingsSidebarProps = ComponentProps<typeof Sidebar>;

/**
 * Settings sidebar component that replaces the main sidebar when settings are open.
 * Shows settings navigation sections instead of thread list.
 */
export function SettingsSidebar(props: SettingsSidebarProps) {
  const { activeSettingsSection, setActiveSettingsSection } = useUiStore();
  const { t } = useTranslation("settings");

  return (
    <Sidebar className="border-r-0" {...props}>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>{t("view.title")}</SidebarGroupLabel>
          <SidebarMenu>
            {navigationItems.map((item, index) => {
              if (item === "separator") {
                return (
                  <SidebarSeparator
                    key={`separator-${index}`}
                    className="my-2"
                  />
                );
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
                    <span>{t(item.labelKey)}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
        <NavSecondary className="mt-auto" />
      </SidebarContent>
    </Sidebar>
  );
}
