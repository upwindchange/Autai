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

// Define popular sites for random selection
const popularSites: PageItem[] = [
  { title: "Google", url: "https://www.google.com", favicon: "🔍" },
  { title: "YouTube", url: "https://www.youtube.com", favicon: "📺" },
  { title: "Facebook", url: "https://www.facebook.com", favicon: "📘" },
  { title: "Baidu", url: "https://www.baidu.com", favicon: "🅱" },
  { title: "Wikipedia", url: "https://www.wikipedia.org", favicon: "📚" },
  { title: "Twitter", url: "https://twitter.com", favicon: "🐦" },
  { title: "Instagram", url: "https://www.instagram.com", favicon: "📸" },
  { title: "Reddit", url: "https://www.reddit.com", favicon: "👥" },
  { title: "Amazon", url: "https://www.amazon.com", favicon: "🛒" },
  { title: "LinkedIn", url: "https://www.linkedin.com", favicon: "🔗" }
]

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
    const randomIndex = Math.floor(Math.random() * popularSites.length)
    setTasks(prev => [...prev, {
      title: "New Task",
      favicon: "📋",
      pages: [popularSites[randomIndex]]
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
