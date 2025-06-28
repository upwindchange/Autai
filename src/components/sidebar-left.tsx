"use client"

import * as React from "react"
import {
  Blocks,
  Calendar,
  MessageCircleQuestion,
  Settings2,
  Trash2,
} from "lucide-react"

import { NavSecondary } from "@/components/nav-secondary"
import { NavTasks } from "@/components/nav-tasks"
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
} from "@/components/ui/sidebar"

// This is sample data.
const data = {
  navSecondary: [
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
  ],
    tasks: [
    {
      title: "Personal Life Management",
      favicon: "🏠",
      pages: [
        {
          title: "Daily Journal & Reflection",
          url: "https://example.com/journal",
          favicon: "📔",
        },
        {
          title: "Health & Wellness Tracker",
          url: "https://example.com/health",
          favicon: "🍏",
        },
        {
          title: "Personal Growth & Learning Goals",
          url: "https://example.com/growth",
          favicon: "🌟",
        },
      ],
    },
    {
      title: "Professional Development",
      favicon: "💼",
      pages: [
        {
          title: "Career Objectives & Milestones",
          url: "https://example.com/career",
          favicon: "🎯",
        },
        {
          title: "Skill Acquisition & Training Log",
          url: "https://example.com/skills",
          favicon: "🧠",
        },
        {
          title: "Networking Contacts & Events",
          url: "https://example.com/networking",
          favicon: "🤝",
        },
      ],
    },
    {
      title: "Creative Projects",
      favicon: "🎨",
      pages: [
        {
          title: "Writing Ideas & Story Outlines",
          url: "https://example.com/writing",
          favicon: "✍️",
        },
        {
          title: "Art & Design Portfolio",
          url: "https://example.com/portfolio",
          favicon: "🖼️",
        },
        {
          title: "Music Composition & Practice Log",
          url: "https://example.com/music",
          favicon: "🎵",
        },
      ],
    },
    {
      title: "Home Management",
      favicon: "🏡",
      pages: [
        {
          title: "Household Budget & Expense Tracking",
          url: "https://example.com/budget",
          favicon: "💰",
        },
        {
          title: "Home Maintenance Schedule & Tasks",
          url: "https://example.com/maintenance",
          favicon: "🔧",
        },
        {
          title: "Family Calendar & Event Planning",
          url: "https://example.com/calendar",
          favicon: "📅",
        },
      ],
    },
    {
      title: "Travel & Adventure",
      favicon: "🧳",
      pages: [
        {
          title: "Trip Planning & Itineraries",
          url: "https://example.com/trip-planning",
          favicon: "🗺️",
        },
        {
          title: "Travel Bucket List & Inspiration",
          url: "https://example.com/bucket-list",
          favicon: "🌎",
        },
        {
          title: "Travel Journal & Photo Gallery",
          url: "https://example.com/travel-journal",
          favicon: "📸",
        },
      ],
    },
  ],
}

import { useState } from "react"
import { Button } from "@/components/ui/button"

export function SidebarLeft({
  onPageSelect,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  onPageSelect?: (taskIndex: number, pageIndex: number) => void;
}) {
  const [tasks, setTasks] = useState(data.tasks)
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
      pages: []
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
        <NavSecondary items={data.navSecondary} className="mt-auto" />
      </SidebarContent>
    </Sidebar>
  )
}
