import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import type { ReactNode, RefObject } from 'react';

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

interface TasksContextType {
  // State
  tasks: TaskItem[];
  expandedIndex: number | null;
  selectedPageUrl: string | null;
  activeTaskId: string | null;
  activeViewKey: string | null;
  
  // Actions
  setExpandedIndex: (index: number | null) => void;
  handleAddTask: () => Promise<void>;
  handleTaskDelete: (index: number) => void;
  handlePageSelect: (taskIndex: number, pageIndex: number) => Promise<void>;
  
  // Container bounds management
  setContainerRef: (ref: RefObject<HTMLDivElement | null>) => void;
  getContainerBounds: () => { x: number; y: number; width: number; height: number };
}

const TasksContext = createContext<TasksContextType | undefined>(undefined);

/**
 * Default sites for new tasks - randomly selected when creating a new task
 */
const POPULAR_SITES = [
  { url: "https://www.reddit.com" },
  { url: "https://www.amazon.com" },
] as const;

/**
 * Empty bounds used to hide views
 */
const EMPTY_BOUNDS = { x: 0, y: 0, width: 0, height: 0 } as const;

/**
 * Generates a unique key for each view based on task ID and page index
 */
const getViewKey = (taskId: string, pageIndex: number) => `${taskId}-${pageIndex}`;

interface TasksProviderProps {
  children: ReactNode;
}

export function TasksProvider({ children }: TasksProviderProps) {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [selectedPageUrl, setSelectedPageUrl] = useState<string | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [activeViewKey, setActiveViewKey] = useState<string | null>(null);
  
  const containerRef = useRef<RefObject<HTMLDivElement | null>>(null);
  const viewManagersRef = useRef<Map<string, ViewManager>>(new Map());

  /**
   * Sets the container ref from the App component
   */
  const setContainerRef = useCallback((ref: RefObject<HTMLDivElement | null>) => {
    containerRef.current = ref;
  }, []);

  /**
   * Calculates the bounds of the main content container for WebContentsView positioning
   */
  const getContainerBounds = useCallback(() => {
    const container = containerRef.current?.current;
    if (!container) return { x: 0, y: 0, width: 0, height: 0 };

    const rect = container.getBoundingClientRect();
    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  }, []);

  /**
   * Track active task ID based on expanded index
   */
  useEffect(() => {
    if (expandedIndex !== null && tasks[expandedIndex]) {
      setActiveTaskId(tasks[expandedIndex].id);
    } else {
      setActiveTaskId(null);
    }
  }, [expandedIndex, tasks]);

  /**
   * Listen for active view changes
   */
  useEffect(() => {
    const handleActiveViewChanged = (_event: any, viewKey: string) => {
      setActiveViewKey(viewKey);
    };

    window.ipcRenderer.on('active-view-changed', handleActiveViewChanged);
    
    return () => {
      window.ipcRenderer.off('active-view-changed', handleActiveViewChanged);
    };
  }, []);

  /**
   * Hides all views except the specified one by setting their bounds to empty
   */
  const hideAllViewsExcept = useCallback(async (activeKey: string) => {
    const hidePromises = Array.from(viewManagersRef.current.keys())
      .filter((key) => key !== activeKey)
      .map((key) =>
        window.ipcRenderer.invoke("view:setBounds", key, EMPTY_BOUNDS)
      );

    await Promise.all(hidePromises);
  }, []);

  /**
   * Creates a ViewManager that handles resize observation and cleanup for a WebContentsView
   */
  const createViewManager = useCallback(
    (key: string): ViewManager => {
      const resizeObserver = new ResizeObserver(() => {
        window.ipcRenderer.invoke("view:setBounds", key, getContainerBounds());
      });

      if (containerRef.current?.current) {
        resizeObserver.observe(containerRef.current.current);
      }

      return {
        resizeObserver,
        cleanup: () => {
          resizeObserver.disconnect();
          window.ipcRenderer.invoke("view:remove", key);
        },
      };
    },
    [getContainerBounds]
  );

  const cleanupView = useCallback((key: string) => {
    const manager = viewManagersRef.current.get(key);
    if (manager) {
      manager.cleanup();
      viewManagersRef.current.delete(key);
    }
  }, []);

  const cleanupTaskViews = useCallback(
    (task: TaskItem) => {
      task.pages.forEach((_, pageIndex) => {
        cleanupView(getViewKey(task.id, pageIndex));
      });
    },
    [cleanupView]
  );

  const createNewView = useCallback(
    async (key: string, url: string) => {
      await window.ipcRenderer.invoke("view:create", key, {
        webPreferences: {},
      });

      await window.ipcRenderer.invoke(
        "view:setBounds",
        key,
        getContainerBounds()
      );

      const { title, favicon } = await window.ipcRenderer.invoke(
        "nav:loadURL",
        key,
        url
      );

      const manager = createViewManager(key);
      viewManagersRef.current.set(key, manager);

      return { title, favicon };
    },
    [getContainerBounds, createViewManager]
  );

  /**
   * Internal page selection handler that accepts a tasks array
   */
  const handlePageSelectInternal = useCallback(
    async (taskIndex: number, pageIndex: number, tasksArray: TaskItem[]) => {
      const task = tasksArray[taskIndex];

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
      await window.ipcRenderer.invoke(
        "view:setBounds",
        key,
        getContainerBounds()
      );

      window.ipcRenderer.send("active-view-changed", key);

      if (task.pages[pageIndex]) {
        setSelectedPageUrl(task.pages[pageIndex].url);
      }
    },
    [hideAllViewsExcept, getContainerBounds]
  );

  /**
   * Handles page selection: shows the selected view and hides others
   */
  const handlePageSelect = useCallback(
    async (taskIndex: number, pageIndex: number) => {
      await handlePageSelectInternal(taskIndex, pageIndex, tasks);
    },
    [tasks, handlePageSelectInternal]
  );

  /**
   * Creates a new task with a random popular site as the initial page
   */
  const handleAddTask = useCallback(async () => {
    const newIndex = tasks.length;
    const randomSite =
      POPULAR_SITES[Math.floor(Math.random() * POPULAR_SITES.length)];

    const newTaskId = Date.now().toString();
    const newTask: TaskItem = {
      id: newTaskId,
      title: "New Task",
      favicon: "📋",
      pages: [
        {
          ...randomSite,
          title: "Loading...",
          favicon: "⏳",
        },
      ],
    };

    // Add the new task first
    const updatedTasks = [...tasks, newTask];
    setTasks(updatedTasks);
    setExpandedIndex(newIndex);

    const key = getViewKey(newTaskId, 0);

    try {
      const { title, favicon } = await createNewView(key, randomSite.url);

      // Update the task with the loaded page info
      setTasks((prev) => {
        const updated = [...prev];
        if (updated[newIndex]) {
          updated[newIndex] = {
            ...updated[newIndex],
            pages: [
              {
                ...updated[newIndex].pages[0],
                title,
                favicon,
              },
            ],
          };
        }
        return updated;
      });

      // Now select the page with the updated tasks array
      await handlePageSelectInternal(newIndex, 0, updatedTasks);
    } catch (error) {
      console.error(`Failed to create view ${key}:`, error);

      setTasks((prev) => {
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
  }, [tasks, createNewView]);

  const handleTaskDelete = useCallback(
    (index: number) => {
      const task = tasks[index];
      cleanupTaskViews(task);

      setTasks((prev) => prev.filter((_, i) => i !== index));

      if (expandedIndex === index) {
        setExpandedIndex(null);
      } else if (expandedIndex !== null && expandedIndex > index) {
        setExpandedIndex(expandedIndex - 1);
      }

      // Notify renderer about task deletion for AI agent cleanup
      window.ipcRenderer.send("task:deleted", task.id);
    },
    [tasks, expandedIndex, cleanupTaskViews]
  );

  /**
   * Cleanup all views when provider unmounts
   */
  useEffect(() => {
    return () => {
      viewManagersRef.current.forEach((manager) => manager.cleanup());
      viewManagersRef.current.clear();
    };
  }, []);

  const value: TasksContextType = {
    tasks,
    expandedIndex,
    selectedPageUrl,
    activeTaskId,
    activeViewKey,
    setExpandedIndex,
    handleAddTask,
    handleTaskDelete,
    handlePageSelect,
    setContainerRef,
    getContainerBounds,
  };

  return <TasksContext.Provider value={value}>{children}</TasksContext.Provider>;
}

export function useTasks() {
  const context = useContext(TasksContext);
  if (context === undefined) {
    throw new Error('useTasks must be used within a TasksProvider');
  }
  return context;
}