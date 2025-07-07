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

interface PageItem {
  title: string;
  url: string;
  favicon: string | ReactNode;
}

interface TaskItem {
  id: string;
  title: string;
  favicon: ReactNode;
  pages: PageItem[];
}

interface ViewManager {
  cleanup: () => void;
  resizeObserver?: ResizeObserver;
}

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
}

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

const EMPTY_BOUNDS = { x: 0, y: 0, width: 0, height: 0 } as const;

const getViewKey = (taskId: string, pageIndex: number) => `${taskId}-${pageIndex}`;

export function SidebarLeft({
  expandedIndex,
  setExpandedIndex,
  getContainerBounds,
  containerRef,
  onPageSelect,
  ...props
}: SidebarLeftProps) {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const viewManagersRef = useRef<Map<string, ViewManager>>(new Map());

  const memoizedGetContainerBounds = useCallback(getContainerBounds, [
    getContainerBounds,
  ]);

  const hideAllViewsExcept = useCallback(async (activeKey: string) => {
    const hidePromises = Array.from(viewManagersRef.current.keys())
      .filter(key => key !== activeKey)
      .map(key => window.ipcRenderer.invoke("view:setBounds", key, EMPTY_BOUNDS));
    
    await Promise.all(hidePromises);
  }, []);

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
    },
    [tasks, expandedIndex, setExpandedIndex, cleanupTaskViews]
  );

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