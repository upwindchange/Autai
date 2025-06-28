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

interface TaskItem {
  title: string;
  favicon: React.ReactNode;
  pages: PageItem[];
}

interface PageItem {
  title: string;
  url: string;
  favicon: React.ReactNode;
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

export function SidebarLeft({
  onPageSelect,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  onPageSelect?: (taskIndex: number, pageIndex: number) => void;
}) {
  const [tasks, setTasks] = useState<TaskItem[]>([])
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null)

  const handleTaskExpand = (index: number | null) => {
    setExpandedIndex(index)
  }

  const handleTaskDelete = (index: number) => {
    // Notify App to clean up views for this task
    tasks[index].pages.forEach((_, pageIndex) => {
      const key = `${index}-${pageIndex}`;
      window.ipcRenderer?.invoke("view:remove", key);
    });

    setTasks(prev => prev.filter((_, i) => i !== index))
    if (expandedIndex === index) {
      setExpandedIndex(null)
    } else if (expandedIndex !== null && expandedIndex > index) {
      setExpandedIndex(expandedIndex - 1)
    }
  }

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
          onExpandChange={handleTaskExpand}
          onTaskDelete={handleTaskDelete}
          onPageSelect={onPageSelect}
        />
        <NavSecondary items={initialNavSecondary} className="mt-auto" />
      </SidebarContent>
    </Sidebar>
  )
}
