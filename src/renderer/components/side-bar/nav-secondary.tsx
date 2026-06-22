import React from "react";

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { SettingsButton } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { useUiStore } from "@/stores/uiStore";
import { Film, MessageSquare } from "lucide-react";

export function NavSecondary({
  ...props
}: React.ComponentPropsWithoutRef<typeof SidebarGroup>) {
  const appMode = useUiStore((s) => s.appMode);
  const setAppMode = useUiStore((s) => s.setAppMode);
  const isEntertainment = appMode === "entertainment";

  return (
    <SidebarGroup {...props}>
      <SidebarGroupContent>
        <SidebarSeparator className="mx-0" />
        <SidebarMenu>
          {/* Provisional mode toggle (English-only placeholder). The real
              entry-point placement is a later UX decision. */}
          <SidebarMenuItem>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2"
              onClick={() => setAppMode(isEntertainment ? "chat" : "entertainment")}
            >
              {isEntertainment ? (
                <MessageSquare className="size-4" />
              ) : (
                <Film className="size-4" />
              )}
              {isEntertainment ? "Back to Chat" : "Entertainment"}
            </Button>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SettingsButton />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
