import React from "react";

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { SettingsButton } from "@/components/settings";
import { useUiStore } from "@/stores/uiStore";
import { ArrowLeftRight } from "lucide-react";
import { useTranslation } from "react-i18next";

export function NavSecondary({
  ...props
}: React.ComponentPropsWithoutRef<typeof SidebarGroup>) {
  const setWelcomeActive = useUiStore((s) => s.setWelcomeActive);
  const { t } = useTranslation("common");

  return (
    <SidebarGroup {...props}>
      <SidebarGroupContent>
        <SidebarSeparator className="mx-0" />
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={() => setWelcomeActive(true)}
              tooltip={t("sidebar.mode.switch")}
            >
              <ArrowLeftRight />
              <span>{t("sidebar.mode.switch")}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SettingsButton />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
