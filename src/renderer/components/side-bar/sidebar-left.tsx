"use client";
import type { ComponentProps } from "react";

import { Sidebar, SidebarContent } from "@/components/ui/sidebar";
import { NavSecondary } from "@/components/side-bar/nav-secondary";
import { ThreadList } from "@/components/assistant-ui/thread-list";

/**
 * Props for the SidebarLeft component
 */
type SidebarLeftProps = ComponentProps<typeof Sidebar>;

/**
 * Left sidebar component that manages AI conversation threads.
 */
export function SidebarLeft(props: SidebarLeftProps) {
  return (
    <Sidebar className="border-r-0" {...props}>
      <SidebarContent>
        <div className="py-1"></div>
        <ThreadList />
        <NavSecondary className="mt-auto" />
      </SidebarContent>
    </Sidebar>
  );
}
