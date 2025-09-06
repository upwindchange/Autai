import { Sidebar, SidebarContent } from "@/components/ui/sidebar";
import { NavSecondary } from "@/components/side-bar/nav-secondary";
import { SettingsNavigation } from "./settings-navigation";
import type { ComponentProps } from "react";

/**
 * Props for the SettingsSidebar component
 */
type SettingsSidebarProps = ComponentProps<typeof Sidebar>;

/**
 * Settings sidebar component that replaces the main sidebar when settings are open.
 * Shows settings navigation sections instead of thread list.
 */
export function SettingsSidebar(props: SettingsSidebarProps) {
  return (
    <Sidebar className="border-r-0" {...props}>
      <SidebarContent>
        <SettingsNavigation />
        <NavSecondary className="mt-auto" />
      </SidebarContent>
    </Sidebar>
  );
}