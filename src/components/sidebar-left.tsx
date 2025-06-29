"use client"

import * as React from "react"
import {
  Blocks,
  Calendar,
  MessageCircleQuestion,
  Settings2,
  Trash2,
  type LucideIcon,
} from "lucide-react"

import { NavSecondary } from "@/components/nav-secondary"
import { NavTasks } from "@/components/nav-tasks"
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
} from "@/components/ui/sidebar"

// Define interfaces matching component props
interface NavSecondaryItem {
  title: string;
  url: string;
  icon: LucideIcon;
  badge?: React.ReactNode;
}


// Initialize navSecondary with current data
const initialNavSecondary: NavSecondaryItem[] = [
  {
    title: "Calendar",
    url: "#",
    icon: Calendar,
  },
  {
    title: "Settings",
    url: "#",
    icon: Settings2,
  },
  {
    title: "Templates",
    url: "#",
    icon: Blocks,
  },
  {
    title: "Trash",
    url: "#",
    icon: Trash2,
  },
  {
    title: "Help",
    url: "#",
    icon: MessageCircleQuestion,
  },
]

import { useState } from "react"
import { Button } from "@/components/ui/button"

import { TaskItem, PageItem } from "@/App"

export function SidebarLeft({
  tasks,
  setTasks,
  expandedIndex,
  setExpandedIndex,
  onTaskDelete,
  onPageSelect,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  tasks: TaskItem[];
  setTasks: React.Dispatch<React.SetStateAction<TaskItem[]>>;
  expandedIndex: number | null;
  setExpandedIndex: React.Dispatch<React.SetStateAction<number | null>>;
  onTaskDelete: (index: number) => void;
  onPageSelect?: (taskIndex: number, pageIndex: number) => void;
}) {

  const handleAddTask = () => {
    const newIndex = tasks.length
    setTasks(prev => [...prev, {
      title: "New Task",
      favicon: "📋",
      pages: [
        {
          title: "LinkedIn",
          url: "https://www.linkedin.com",
          favicon: "🔗",
        }
      ]
    }])
    setExpandedIndex(newIndex)
  }

  return (
    <Sidebar className="border-r-0" {...props}>
      <SidebarHeader>
        <Button
          variant="outline"
          size="sm"
          onClick={handleAddTask}
        >
          + Create New Task
        </Button>
      </SidebarHeader>
      <SidebarContent>
        <NavTasks
          tasks={tasks}
          expandedIndex={expandedIndex}
          onExpandChange={setExpandedIndex}
          onTaskDelete={onTaskDelete}
          onPageSelect={onPageSelect}
        />
        <NavSecondary items={initialNavSecondary} className="mt-auto" />
      </SidebarContent>
    </Sidebar>
  )
}
