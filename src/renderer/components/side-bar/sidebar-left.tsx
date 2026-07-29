"use client";
import type { ComponentProps } from "react";

import { Sidebar, SidebarContent } from "@/components/ui/sidebar";
import { NavSecondary } from "@/components/side-bar/nav-secondary";
import { ThreadList } from "@/components/side-bar/thread-list";
import { EntertainmentThreadList } from "@/components/side-bar/entertainment-thread-list";
import { SidebarToolbar } from "@/components/side-bar/sidebar-toolbar";
import { NewConversationButton } from "@/components/side-bar/new-conversation-button";
import { useUiStore } from "@/stores/uiStore";

type SidebarLeftProps = ComponentProps<typeof Sidebar>;

export function SidebarLeft(props: SidebarLeftProps) {
  // Entertainment has its own assistant-ui-free thread list; chat keeps the
  // assistant-ui-backed one. The toolbar + new-conversation button are shared
  // (they branch internally where needed) and read the same tagStore.
  const appMode = useUiStore((s) => s.appMode);

  return (
    <Sidebar className="border-r-0" {...props}>
      <SidebarContent className="flex-1 overflow-hidden">
        <div className="px-2 pt-2">
          <NewConversationButton />
        </div>
        <div className="mx-2 border-t" />
        <SidebarToolbar />
        <div className="flex-1 overflow-y-auto">
          {appMode === "entertainment" ?
            <EntertainmentThreadList />
          : <ThreadList />}
        </div>
      </SidebarContent>
      <NavSecondary className="shrink-0" />
    </Sidebar>
  );
}
