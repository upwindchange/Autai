import { createContext, useContext, useReducer, useCallback, useRef, useEffect } from 'react';
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
 * Consolidated state for tasks management
 */
interface TasksState {
  tasks: TaskItem[];
  expandedIndex: number | null;
  selectedPageUrl: string | null;
  activeTaskId: string | null;
  activeViewKey: string | null;
}

/**
 * Action types for state reducer
 */
type TasksAction =
  | { type: 'ADD_TASK'; task: TaskItem }
  | { type: 'UPDATE_TASK'; index: number; task: TaskItem }
  | { type: 'DELETE_TASK'; index: number }
  | { type: 'SET_EXPANDED'; index: number | null }
  | { type: 'SET_SELECTED_PAGE'; url: string | null }
  | { type: 'SET_ACTIVE_VIEW'; key: string | null }
  | { type: 'UPDATE_PAGE'; taskIndex: number; pageIndex: number; page: Partial<PageItem> };

interface TasksContextType {
  // State
  state: TasksState;
  
  // Actions
  addTask: () => Promise<void>;
  deleteTask: (index: number) => Promise<void>;
  selectPage: (taskIndex: number, pageIndex: number) => Promise<void>;
  setExpandedIndex: (index: number | null) => void;
  
  // Container bounds management
  setContainerRef: (ref: RefObject<HTMLDivElement | null>) => void;
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

/**
 * Initial state for the reducer
 */
const initialState: TasksState = {
  tasks: [],
  expandedIndex: null,
  selectedPageUrl: null,
  activeTaskId: null,
  activeViewKey: null,
};

/**
 * Reducer to manage tasks state
 */
function tasksReducer(state: TasksState, action: TasksAction): TasksState {
  switch (action.type) {
    case 'ADD_TASK':
      return {
        ...state,
        tasks: [...state.tasks, action.task],
        expandedIndex: state.tasks.length,
        activeTaskId: action.task.id,
      };
      
    case 'UPDATE_TASK':
      return {
        ...state,
        tasks: state.tasks.map((task, i) => 
          i === action.index ? action.task : task
        ),
      };
      
    case 'DELETE_TASK': {
      const newTasks = state.tasks.filter((_, i) => i !== action.index);
      let newExpandedIndex = state.expandedIndex;
      
      if (state.expandedIndex === action.index) {
        newExpandedIndex = null;
      } else if (state.expandedIndex !== null && state.expandedIndex > action.index) {
        newExpandedIndex = state.expandedIndex - 1;
      }
      
      return {
        ...state,
        tasks: newTasks,
        expandedIndex: newExpandedIndex,
        activeTaskId: newExpandedIndex !== null ? newTasks[newExpandedIndex]?.id || null : null,
      };
    }
      
    case 'SET_EXPANDED':
      return {
        ...state,
        expandedIndex: action.index,
        activeTaskId: action.index !== null ? state.tasks[action.index]?.id || null : null,
      };
      
    case 'SET_SELECTED_PAGE':
      return {
        ...state,
        selectedPageUrl: action.url,
      };
      
    case 'SET_ACTIVE_VIEW':
      return {
        ...state,
        activeViewKey: action.key,
      };
      
    case 'UPDATE_PAGE': {
      const newTasks = [...state.tasks];
      if (newTasks[action.taskIndex]?.pages[action.pageIndex]) {
        newTasks[action.taskIndex].pages[action.pageIndex] = {
          ...newTasks[action.taskIndex].pages[action.pageIndex],
          ...action.page,
        };
      }
      return {
        ...state,
        tasks: newTasks,
      };
    }
      
    default:
      return state;
  }
}

interface TasksProviderProps {
  children: ReactNode;
}

/**
 * View lifecycle manager for efficient cleanup and resource management
 */
class ViewLifecycleManager {
  private views = new Map<string, ResizeObserver>();
  private containerRef: RefObject<HTMLDivElement | null> | null = null;
  
  setContainerRef(ref: RefObject<HTMLDivElement | null>) {
    this.containerRef = ref;
  }
  
  getContainerBounds() {
    const container = this.containerRef?.current;
    if (!container) return EMPTY_BOUNDS;
    
    const rect = container.getBoundingClientRect();
    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  }
  
  async createView(key: string, url: string): Promise<{ title: string; favicon: string }> {
    // Create the view and load URL in parallel setup
    await window.ipcRenderer.invoke("view:create", key, { webPreferences: {} });
    
    // Set initial bounds and load URL concurrently
    const [_, metadata] = await Promise.all([
      window.ipcRenderer.invoke("view:setBounds", key, this.getContainerBounds()),
      window.ipcRenderer.invoke("nav:loadURL", key, url),
    ]);
    
    // Setup resize observer
    const resizeObserver = new ResizeObserver(() => {
      window.ipcRenderer.invoke("view:setBounds", key, this.getContainerBounds());
    });
    
    if (this.containerRef?.current) {
      resizeObserver.observe(this.containerRef.current);
    }
    
    this.views.set(key, resizeObserver);
    return metadata;
  }
  
  async showView(key: string, allViewKeys: string[]) {
    // Hide all other views and show the target view concurrently
    const hidePromises = allViewKeys
      .filter(k => k !== key)
      .map(k => window.ipcRenderer.invoke("view:setBounds", k, EMPTY_BOUNDS));
    
    await Promise.all([
      ...hidePromises,
      window.ipcRenderer.invoke("view:setBounds", key, this.getContainerBounds()),
    ]);
    
    window.ipcRenderer.send("active-view-changed", key);
  }
  
  deleteView(key: string) {
    const observer = this.views.get(key);
    if (observer) {
      observer.disconnect();
      this.views.delete(key);
    }
    window.ipcRenderer.invoke("view:remove", key);
  }
  
  deleteAllTaskViews(taskId: string, pageCount: number) {
    const deletions = [];
    for (let i = 0; i < pageCount; i++) {
      const key = getViewKey(taskId, i);
      this.deleteView(key);
      deletions.push(key);
    }
    return deletions;
  }
  
  cleanup() {
    this.views.forEach(observer => observer.disconnect());
    this.views.clear();
  }
}

export function TasksProvider({ children }: TasksProviderProps) {
  const [state, dispatch] = useReducer(tasksReducer, initialState);
  const viewManager = useRef(new ViewLifecycleManager());
  
  const setContainerRef = useCallback((ref: RefObject<HTMLDivElement | null>) => {
    viewManager.current.setContainerRef(ref);
  }, []);
  
  const setExpandedIndex = useCallback((index: number | null) => {
    dispatch({ type: 'SET_EXPANDED', index });
  }, []);
  
  /**
   * Listen for active view changes from main process
   */
  useEffect(() => {
    const handleActiveViewChanged = (_event: any, viewKey: string) => {
      dispatch({ type: 'SET_ACTIVE_VIEW', key: viewKey });
    };
    
    window.ipcRenderer.on('active-view-changed', handleActiveViewChanged);
    return () => {
      window.ipcRenderer.off('active-view-changed', handleActiveViewChanged);
    };
  }, []);

  /**
   * Creates a new task with initial page
   */
  const addTask = useCallback(async () => {
    const taskId = Date.now().toString();
    const randomSite = POPULAR_SITES[Math.floor(Math.random() * POPULAR_SITES.length)];
    const newIndex = state.tasks.length;
    
    // Create initial task structure
    const newTask: TaskItem = {
      id: taskId,
      title: "New Task",
      favicon: "📋",
      pages: [{
        url: randomSite.url,
        title: "Loading...",
        favicon: "⏳",
      }],
    };
    
    // Add task to state immediately for UI responsiveness
    dispatch({ type: 'ADD_TASK', task: newTask });
    
    try {
      // Create view and load page
      const key = getViewKey(taskId, 0);
      const metadata = await viewManager.current.createView(key, randomSite.url);
      
      // Update task with loaded metadata
      dispatch({
        type: 'UPDATE_PAGE',
        taskIndex: newIndex,
        pageIndex: 0,
        page: metadata,
      });
      
      // Show the new view
      const allViewKeys = getAllViewKeys([...state.tasks, newTask]);
      await viewManager.current.showView(key, allViewKeys);
      
      dispatch({ type: 'SET_SELECTED_PAGE', url: randomSite.url });
    } catch (error) {
      console.error('Failed to create task:', error);
      
      // Update task to show error state
      dispatch({
        type: 'UPDATE_PAGE',
        taskIndex: newIndex,
        pageIndex: 0,
        page: {
          title: "Failed to load",
          favicon: "❌",
        },
      });
    }
  }, [state.tasks]);
  
  /**
   * Deletes a task and all its associated views
   */
  const deleteTask = useCallback(async (index: number) => {
    const task = state.tasks[index];
    if (!task) return;
    
    // Clean up all views for this task
    viewManager.current.deleteAllTaskViews(task.id, task.pages.length);
    
    // Remove task from state
    dispatch({ type: 'DELETE_TASK', index });
    
    // Notify main process for AI agent cleanup
    window.ipcRenderer.send("task:deleted", task.id);
  }, [state.tasks]);
  
  /**
   * Selects a page within a task
   */
  const selectPage = useCallback(async (taskIndex: number, pageIndex: number) => {
    const task = state.tasks[taskIndex];
    if (!task || !task.pages[pageIndex]) {
      console.error(`Invalid task ${taskIndex} or page ${pageIndex}`);
      return;
    }
    
    const key = getViewKey(task.id, pageIndex);
    const allViewKeys = getAllViewKeys(state.tasks);
    
    try {
      await viewManager.current.showView(key, allViewKeys);
      dispatch({ type: 'SET_SELECTED_PAGE', url: task.pages[pageIndex].url });
    } catch (error) {
      console.error('Failed to select page:', error);
    }
  }, [state.tasks]);

  /**
   * Cleanup on unmount
   */
  useEffect(() => {
    return () => {
      viewManager.current.cleanup();
    };
  }, []);

  const value: TasksContextType = {
    state,
    addTask,
    deleteTask,
    selectPage,
    setExpandedIndex,
    setContainerRef,
  };
  
  return <TasksContext.Provider value={value}>{children}</TasksContext.Provider>;
}

/**
 * Helper to get all view keys from tasks
 */
function getAllViewKeys(tasks: TaskItem[]): string[] {
  const keys: string[] = [];
  tasks.forEach(task => {
    task.pages.forEach((_, pageIndex) => {
      keys.push(getViewKey(task.id, pageIndex));
    });
  });
  return keys;
}

export function useTasks() {
  const context = useContext(TasksContext);
  if (context === undefined) {
    throw new Error('useTasks must be used within a TasksProvider');
  }
  return context;
}

// Export individual state selectors for convenience
export function useTasksState() {
  const { state } = useTasks();
  return state;
}

export function useTasksActions() {
  const { addTask, deleteTask, selectPage, setExpandedIndex } = useTasks();
  return { addTask, deleteTask, selectPage, setExpandedIndex };
}