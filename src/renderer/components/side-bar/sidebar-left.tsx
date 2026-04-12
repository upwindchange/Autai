"use client";
import type { ComponentProps } from "react";

import { Sidebar, SidebarContent } from "@/components/ui/sidebar";
import { NavSecondary } from "@/components/side-bar/nav-secondary";
import { ThreadList } from "@/components/side-bar/thread-list";
import { SidebarToolbar } from "@/components/side-bar/sidebar-toolbar";
import { NewConversationButton } from "@/components/side-bar/new-conversation-button";

type SidebarLeftProps = ComponentProps<typeof Sidebar>;

export function SidebarLeft(props: SidebarLeftProps) {
  return (
    <Sidebar className="border-r-0" {...props}>
      <SidebarContent>
        <div className="px-2 pt-2">
          <NewConversationButton />
        </div>
        <div className="mx-2 border-t" />
        <SidebarToolbar />
        <ThreadList />
        <NavSecondary className="mt-auto" />
      </SidebarContent>
    </Sidebar>
  );
}
