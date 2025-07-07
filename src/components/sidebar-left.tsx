"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import type {
  ReactNode,
  ComponentProps,
  Dispatch,
  SetStateAction,
  RefObject,
} from "react";
import {
  Blocks,
  Calendar,
  MessageCircleQuestion,
  Settings2,
  Trash2,
  type LucideIcon,
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { NavSecondary } from "@/components/nav-secondary";
import { NavTasks } from "@/components/nav-tasks";

// Define interfaces matching component props
interface NavSecondaryItem {
  title: string;
  url: string;
  icon: LucideIcon;
  badge?: ReactNode;
}
// Define task interfaces for App state
interface PageItem {
  title: string;
  url: string;
  favicon: string | ReactNode; // Allow both URL strings and React elements
}

interface TaskItem {
  id: string;
  title: string;
  favicon: ReactNode;
  pages: PageItem[];
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
];

// Define popular sites for random selection
const popularSites = [
  { url: "https://www.google.com" },
  { url: "https://www.youtube.com" },
  { url: "https://www.facebook.com" },
  { url: "https://www.baidu.com" },
  { url: "https://www.wikipedia.org" },
  { url: "https://twitter.com" },
  { url: "https://www.instagram.com" },
  { url: "https://www.reddit.com" },
  { url: "https://www.amazon.com" },
  { url: "https://www.linkedin.com" },
];

export function SidebarLeft({
  expandedIndex,
  setExpandedIndex,
  getContainerBounds,
  containerRef,
  onPageSelect,
  ...props
}: ComponentProps<typeof Sidebar> & {
  expandedIndex: number | null;
  setExpandedIndex: Dispatch<SetStateAction<number | null>>;
  getContainerBounds: () => {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  containerRef: RefObject<HTMLDivElement | null>;
  onPageSelect?: (url: string) => void;
}) {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  // Create ref for storing cleanup functions
  const viewCleanupRefs = useRef<Record<string, () => void>>({});

  // Handle page selection
  const handlePageSelect = useCallback(
    async (taskIndex: number, pageIndex: number, tasksArray?: TaskItem[]) => {
      const currentTasks = tasksArray || tasks;
      const task = currentTasks[taskIndex];
      if (!task) {
        console.error(`Task at index ${taskIndex} not found`);
        return;
      }
      const key = `${task.id}-${pageIndex}`;

      // Ensure view exists (should be pre-created)
      if (!viewCleanupRefs.current[key]) {
        console.error(`View ${key} not found!`);
        return;
      }

      // Hide all views except the active one
      Object.keys(viewCleanupRefs.current || {}).forEach((viewKey) => {
        if (viewKey !== key) {
          window.ipcRenderer.invoke("view:setBounds", viewKey, {
            x: 0,
            y: 0,
            width: 0,
            height: 0,
          });
        }
      });

      // Show active view with proper coordinates
      window.ipcRenderer.invoke("view:setBounds", key, getContainerBounds());

      // Emit active view change event for link hints
      window.ipcRenderer.send("active-view-changed", key);

      // Propagate selected page URL to parent component
      if (onPageSelect) {
        const page = task.pages[pageIndex];
        onPageSelect(page.url);
      }
    },
    [tasks, getContainerBounds, onPageSelect]
  );

  const handleAddTask = async () => {
    const newIndex = tasks.length;
    const randomIndex = Math.floor(Math.random() * popularSites.length);
    const newSite = popularSites[randomIndex];

    // Create task immediately with placeholder data
    const newTaskId = Date.now().toString();
    const newTask = {
      id: newTaskId,
      title: "New Task",
      favicon: "📋",
      pages: [
        {
          ...newSite,
          title: "Loading...",
          favicon: "⏳",
        },
      ],
    };
    
    setTasks((prev: TaskItem[]) => [...prev, newTask]);
    setExpandedIndex(newIndex);

    // Create view asynchronously
    const key = `${newTaskId}-0`;
    try {
      console.log(`Creating view for key: ${key}`);
      await window.ipcRenderer.invoke("view:create", key, {
        webPreferences: {},
      });

      // Set initial bounds
      await window.ipcRenderer.invoke(
        "view:setBounds",
        key,
        getContainerBounds()
      );

      // Load URL and get metadata
      const { title, favicon } = await window.ipcRenderer.invoke(
        "nav:loadURL",
        key,
        newSite.url
      );

      // Update task metadata
      setTasks((prev: TaskItem[]) => {
        const newTasks = [...prev];
        if (newTasks[newIndex]?.pages?.[0]) {
          newTasks[newIndex] = { ...newTasks[newIndex] };
          newTasks[newIndex].pages = [...newTasks[newIndex].pages];
          newTasks[newIndex].pages[0] = {
            ...newTasks[newIndex].pages[0],
            title: title,
            favicon: favicon,
          };
        }
        return newTasks;
      });
      // Setup resize observer
      const resizeObserver = new ResizeObserver(() => {
        window.ipcRenderer.invoke("view:setBounds", key, getContainerBounds());
      });

      // Attach observer to container
      if (containerRef.current) {
        resizeObserver.observe(containerRef.current);
      }

      // Store cleanup function
      viewCleanupRefs.current[key] = () => {
        resizeObserver.disconnect();
        window.ipcRenderer.invoke("view:remove", key);
      };

      console.log(`Created view for key: ${key}`);
      
      // Automatically select this page to trigger hint detection
      // Pass the updated tasks array to avoid stale state
      const updatedTasks = [...tasks, newTask];
      handlePageSelect(newIndex, 0, updatedTasks);
    } catch (error) {
      console.error(`Failed to create view ${key}:`, error);

      // Update task to show error state
      setTasks((prev: TaskItem[]) => {
        const newTasks = [...prev];
        if (newTasks[newIndex]) {
          newTasks[newIndex].pages[0] = {
            ...newTasks[newIndex].pages[0],
            title: "Failed to load",
            favicon: "❌",
          };
        }
        return newTasks;
      });
    }
  };

  const handleTaskDelete = useCallback(
    (index: number) => {
      // Clean up views for this task
      const task = tasks[index];
      task.pages.forEach((_: PageItem, pageIndex: number) => {
        const key = `${task.id}-${pageIndex}`;
        // Run stored cleanup function if exists
        const cleanup = viewCleanupRefs.current[key];
        if (cleanup) {
          cleanup();
          delete viewCleanupRefs.current[key];
        }
      });

      setTasks((prev: TaskItem[]) => prev.filter((_: TaskItem, i: number) => i !== index));

      // Update expanded index
      if (expandedIndex === index) {
        setExpandedIndex(null);
      } else if (expandedIndex !== null && expandedIndex > index) {
        setExpandedIndex(expandedIndex - 1);
      }
    },
    [tasks, expandedIndex]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Run all cleanup functions when component unmounts
        Object.values(viewCleanupRefs.current).forEach((cleanup: () => void) => {
            if (cleanup) {
                cleanup()
            }
        });
      viewCleanupRefs.current = {};
    };
  }, []);

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
        <NavSecondary items={initialNavSecondary} className="mt-auto" />
      </SidebarContent>
    </Sidebar>
  );
}
