"use client";
import type { ComponentProps } from "react";
import { useEffect } from "react";

import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { NavSecondary } from "@/components/nav-secondary";
import { NavTasks } from "@/components/nav-tasks";
import { useAppStore } from "@/store/appStore";
import { useViewVisibility } from "@/hooks/use-view-visibility";
import { useIsMobile } from "@/hooks/use-mobile";

/**
 * Props for the SidebarLeft component
 */
type SidebarLeftProps = ComponentProps<typeof Sidebar>

/**
 * Left sidebar component that manages tasks and their associated web views.
 * Each task can contain multiple pages, and each page is rendered in a WebContentsView.
 */
export function SidebarLeft(props: SidebarLeftProps) {
  const {
    tasks,
    expandedTaskId,
    createTask,
    deleteTask,
    selectPage,
    setExpandedTask,
    showSettings
  } = useAppStore();
  
  const { openMobile } = useSidebar();
  const { hideView, showView } = useViewVisibility();
  const isMobile = useIsMobile();
  
  // Handle view visibility when sidebar state changes in mobile/tablet mode
  useEffect(() => {
    // Only manage view visibility in offcanvas mode (mobile/tablet)
    if (!isMobile) return;
    
    if (openMobile) {
      // Sidebar is open in mobile, hide the web view to prevent overlap
      hideView();
    } else {
      // Sidebar is closed, only show the web view if settings is not open
      if (!showSettings) {
        showView(200); // Slightly longer delay for sidebar animation
      }
    }
  }, [openMobile, isMobile, hideView, showView, showSettings]);
  
  // Convert Map to array for NavTasks component
  const tasksArray = Array.from(tasks.values()).map(task => ({
    id: task.id,
    title: task.title,
    favicon: "📋", // Default icon
    pages: Array.from(task.pages.values()).map(page => ({
      title: page.title,
      url: page.url,
      favicon: page.favicon || "🌐"
    }))
  }));
  
  // Find expanded index from taskId
  const expandedIndex = expandedTaskId 
    ? tasksArray.findIndex(task => task.id === expandedTaskId)
    : null;

  return (
    <Sidebar className="border-r-0" {...props}>
      <SidebarHeader>
        <Button variant="outline" size="sm" onClick={() => createTask()}>
          + Create New Task
        </Button>
      </SidebarHeader>
      <SidebarContent>
        <NavTasks
          tasks={tasksArray}
          expandedIndex={expandedIndex}
          onExpandChange={(index) => {
            const taskId = index !== null ? tasksArray[index]?.id || null : null;
            setExpandedTask(taskId);
          }}
          onTaskDelete={(index) => {
            const taskId = tasksArray[index]?.id;
            if (taskId) deleteTask(taskId);
          }}
          onPageSelect={(taskIndex, pageIndex) => {
            const task = tasksArray[taskIndex];
            if (!task) return;
            const pageIds = Array.from(tasks.get(task.id)?.pages.keys() || []);
            const pageId = pageIds[pageIndex];
            if (pageId) selectPage(task.id, pageId);
          }}
        />
        <NavSecondary className="mt-auto" />
      </SidebarContent>
    </Sidebar>
  );
}
