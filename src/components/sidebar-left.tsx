"use client";
import type { ComponentProps } from "react";

import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { NavSecondary } from "@/components/nav-secondary";
import { NavTasks } from "@/components/nav-tasks";
import { useTasks } from "@/contexts";

/**
 * Props for the SidebarLeft component
 */
interface SidebarLeftProps extends ComponentProps<typeof Sidebar> {}

/**
 * Left sidebar component that manages tasks and their associated web views.
 * Each task can contain multiple pages, and each page is rendered in a WebContentsView.
 */
export function SidebarLeft(props: SidebarLeftProps) {
  const {
    tasks,
    expandedIndex,
    setExpandedIndex,
    handleAddTask,
    handleTaskDelete,
    handlePageSelect,
  } = useTasks();

  return (
    <Sidebar className="border-r-0" {...props}>
      <SidebarHeader>
        <Button variant="outline" size="sm" onClick={handleAddTask}>
          + Create New Task
        </Button>
      </SidebarHeader>
      <SidebarContent>
        <NavTasks
          tasks={tasks}
          expandedIndex={expandedIndex}
          onExpandChange={setExpandedIndex}
          onTaskDelete={handleTaskDelete}
          onPageSelect={handlePageSelect}
        />
        <NavSecondary className="mt-auto" />
      </SidebarContent>
    </Sidebar>
  );
}
