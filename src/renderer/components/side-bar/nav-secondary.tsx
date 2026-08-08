import React from "react";

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { SettingsButton } from "@/components/settings";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useUiStore, type AppMode } from "@/stores/uiStore";
import {
  ChevronDown,
  Film,
  MessageSquare,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";

// Mode registry — the single place to add a new app mode. Append an entry and
// the sidebar dropdown picks it up (the store type must widen too, but every UI
// switchpoint reads from here rather than a hardcoded toggle).
const MODES: { value: AppMode; labelKey: string; icon: LucideIcon }[] = [
  { value: "chat", labelKey: "sidebar.mode.chat", icon: MessageSquare },
  {
    value: "entertainment",
    labelKey: "sidebar.mode.entertainment",
    icon: Film,
  },
];

export function NavSecondary({
  ...props
}: React.ComponentPropsWithoutRef<typeof SidebarGroup>) {
  const appMode = useUiStore((s) => s.appMode);
  const setAppMode = useUiStore((s) => s.setAppMode);
  const { t } = useTranslation("common");

  // The active entry drives the trigger's icon + label. Falls back to the first
  // mode if the store ever holds a value not in the registry.
  const active = MODES.find((m) => m.value === appMode) ?? MODES[0];
  const ActiveIcon = active.icon;

  return (
    <SidebarGroup {...props}>
      <SidebarGroupContent>
        <SidebarSeparator className="mx-0" />
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start gap-2"
                >
                  <ActiveIcon className="size-4" />
                  <span className="flex-1 text-left">{t(active.labelKey)}</span>
                  <ChevronDown className="size-4 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="w-(--radix-dropdown-menu-trigger-width)"
              >
                <DropdownMenuRadioGroup
                  value={appMode}
                  onValueChange={(v) => setAppMode(v as AppMode)}
                >
                  {MODES.map((m) => {
                    const Icon = m.icon;
                    return (
                      <DropdownMenuRadioItem key={m.value} value={m.value}>
                        <Icon className="size-4" />
                        {t(m.labelKey)}
                      </DropdownMenuRadioItem>
                    );
                  })}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SettingsButton />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
