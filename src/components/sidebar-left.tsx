"use client";
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import type {
  ReactNode,
  ComponentProps,
  Dispatch,
  SetStateAction,
  RefObject,
} from "react";

import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { NavSecondary } from "@/components/nav-secondary";
import { NavTasks } from "@/components/nav-tasks";

/**
 * Represents a single web page within a task
 */
interface PageItem {
  title: string;
  url: string;
  favicon: string | ReactNode;
}

/**
 * Represents a task containing multiple web pages
 */
interface TaskItem {
  id: string;
  title: string;
  favicon: ReactNode;
  pages: PageItem[];
}

/**
 * Manages WebContentsView lifecycle and resize observation
 */
interface ViewManager {
  cleanup: () => void;
  resizeObserver?: ResizeObserver;
}

/**
 * Props for the SidebarLeft component
 */
interface SidebarLeftProps extends ComponentProps<typeof Sidebar> {
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
  onTasksChange?: (tasks: TaskItem[]) => void;
}

/**
 * Default sites for new tasks - randomly selected when creating a new task
 */
const POPULAR_SITES = [
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
] as const;

/**
 * Empty bounds used to hide views
 */
const EMPTY_BOUNDS = { x: 0, y: 0, width: 0, height: 0 } as const;

/**
 * Generates a unique key for each view based on task ID and page index
 */
const getViewKey = (taskId: string, pageIndex: number) => `${taskId}-${pageIndex}`;

/**
 * Left sidebar component that manages tasks and their associated web views.
 * Each task can contain multiple pages, and each page is rendered in a WebContentsView.
 */
export function SidebarLeft({
  expandedIndex,
  setExpandedIndex,
  getContainerBounds,
  containerRef,
  onPageSelect,
  onTasksChange,
  ...props
}: SidebarLeftProps) {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  /**
   * Map of view key to ViewManager for lifecycle management
   */
  const viewManagersRef = useRef<Map<string, ViewManager>>(new Map());

  const memoizedGetContainerBounds = useCallback(getContainerBounds, [
    getContainerBounds,
  ]);

  /**
   * Hides all views except the specified one by setting their bounds to empty
   */
  const hideAllViewsExcept = useCallback(async (activeKey: string) => {
    const hidePromises = Array.from(viewManagersRef.current.keys())
      .filter(key => key !== activeKey)
      .map(key => window.ipcRenderer.invoke("view:setBounds", key, EMPTY_BOUNDS));
    
    await Promise.all(hidePromises);
  }, []);

  /**
   * Creates a ViewManager that handles resize observation and cleanup for a WebContentsView
   */
  const createViewManager = useCallback((key: string): ViewManager => {
    const resizeObserver = new ResizeObserver(() => {
      window.ipcRenderer.invoke("view:setBounds", key, memoizedGetContainerBounds());
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return {
      resizeObserver,
      cleanup: () => {
        resizeObserver.disconnect();
        window.ipcRenderer.invoke("view:remove", key);
      }
    };
  }, [containerRef, memoizedGetContainerBounds]);

  const cleanupView = useCallback((key: string) => {
    const manager = viewManagersRef.current.get(key);
    if (manager) {
      manager.cleanup();
      viewManagersRef.current.delete(key);
    }
  }, []);

  const cleanupTaskViews = useCallback((task: TaskItem) => {
    task.pages.forEach((_, pageIndex) => {
      cleanupView(getViewKey(task.id, pageIndex));
    });
  }, [cleanupView]);

  /**
   * Handles page selection: shows the selected view and hides others
   */
  const handlePageSelect = useCallback(
    async (taskIndex: number, pageIndex: number, tasksArray?: TaskItem[]) => {
      const currentTasks = tasksArray || tasks;
      const task = currentTasks[taskIndex];
      
      if (!task) {
        console.error(`Task at index ${taskIndex} not found`);
        return;
      }
      
      const key = getViewKey(task.id, pageIndex);

      if (!viewManagersRef.current.has(key)) {
        console.error(`View ${key} not found!`);
        return;
      }

      await hideAllViewsExcept(key);
      await window.ipcRenderer.invoke("view:setBounds", key, memoizedGetContainerBounds());
      
      window.ipcRenderer.send("active-view-changed", key);

      if (onPageSelect && task.pages[pageIndex]) {
        onPageSelect(task.pages[pageIndex].url);
      }
    },
    [memoizedGetContainerBounds, onPageSelect, tasks, hideAllViewsExcept]
  );

  const createNewView = useCallback(async (key: string, url: string) => {
    await window.ipcRenderer.invoke("view:create", key, {
      webPreferences: {},
    });

    await window.ipcRenderer.invoke("view:setBounds", key, memoizedGetContainerBounds());

    const { title, favicon } = await window.ipcRenderer.invoke("nav:loadURL", key, url);
    
    const manager = createViewManager(key);
    viewManagersRef.current.set(key, manager);

    return { title, favicon };
  }, [memoizedGetContainerBounds, createViewManager]);

  /**
   * Creates a new task with a random popular site as the initial page
   */
  const handleAddTask = useCallback(async () => {
    const newIndex = tasks.length;
    const randomSite = POPULAR_SITES[Math.floor(Math.random() * POPULAR_SITES.length)];
    
    const newTaskId = Date.now().toString();
    const newTask: TaskItem = {
      id: newTaskId,
      title: "New Task",
      favicon: "📋",
      pages: [{
        ...randomSite,
        title: "Loading...",
        favicon: "⏳",
      }],
    };

    setTasks(prev => [...prev, newTask]);
    setExpandedIndex(newIndex);

    const key = getViewKey(newTaskId, 0);
    
    try {
      const { title, favicon } = await createNewView(key, randomSite.url);

      setTasks(prev => {
        const updated = [...prev];
        if (updated[newIndex]) {
          updated[newIndex] = {
            ...updated[newIndex],
            pages: [{
              ...updated[newIndex].pages[0],
              title,
              favicon,
            }],
          };
        }
        return updated;
      });

      const updatedTasks = [...tasks, newTask];
      await handlePageSelect(newIndex, 0, updatedTasks);
    } catch (error) {
      console.error(`Failed to create view ${key}:`, error);
      
      setTasks(prev => {
        const updated = [...prev];
        if (updated[newIndex]) {
          updated[newIndex].pages[0] = {
            ...updated[newIndex].pages[0],
            title: "Failed to load",
            favicon: "❌",
          };
        }
        return updated;
      });
    }
  }, [tasks, setExpandedIndex, createNewView, handlePageSelect]);

  const handleTaskDelete = useCallback(
    (index: number) => {
      const task = tasks[index];
      cleanupTaskViews(task);

      setTasks(prev => prev.filter((_, i) => i !== index));

      if (expandedIndex === index) {
        setExpandedIndex(null);
      } else if (expandedIndex !== null && expandedIndex > index) {
        setExpandedIndex(expandedIndex - 1);
      }

      // Notify renderer about task deletion for AI agent cleanup
      window.ipcRenderer.send('task:deleted', task.id);
    },
    [tasks, expandedIndex, setExpandedIndex, cleanupTaskViews]
  );

  /**
   * Notify parent component when tasks change
   */
  useEffect(() => {
    onTasksChange?.(tasks);
  }, [tasks, onTasksChange]);

  /**
   * Cleanup all views when component unmounts
   */
  useEffect(() => {
    return () => {
      viewManagersRef.current.forEach(manager => manager.cleanup());
      viewManagersRef.current.clear();
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
        <NavSecondary className="mt-auto" />
      </SidebarContent>
    </Sidebar>
  );
}