import type { Rectangle } from 'electron';

/**
 * Core data types shared between main and renderer processes
 */

export interface Page {
  id: string;
  url: string;
  title: string;
  favicon: string;
  createdAt: number;
  lastVisited: number;
}

export interface Task {
  id: string;
  title: string;
  pages: Map<string, Page>;  // pageId -> Page
  activePageId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface View {
  id: string;
  taskId: string;
  pageId: string;
  webContentsId: number;
  bounds: Rectangle;
  isActive: boolean;
  isVisible: boolean;
}

export interface Agent {
  id: string;
  taskId: string;
  processId: number;
  status: 'idle' | 'processing' | 'error' | 'terminated';
  createdAt: number;
}

/**
 * Full application state
 */
export interface AppState {
  tasks: Record<string, Task>;
  views: Record<string, View>;
  agents: Record<string, Agent>;
  activeTaskId: string | null;
  activeViewId: string | null;
}

/**
 * State change events
 */
export type StateChangeEvent = 
  | { type: 'TASK_CREATED'; task: Task }
  | { type: 'TASK_DELETED'; taskId: string }
  | { type: 'TASK_UPDATED'; taskId: string; updates: Partial<Task> }
  | { type: 'PAGE_ADDED'; taskId: string; page: Page }
  | { type: 'PAGE_REMOVED'; taskId: string; pageId: string }
  | { type: 'PAGE_UPDATED'; taskId: string; pageId: string; updates: Partial<Page> }
  | { type: 'VIEW_CREATED'; view: View }
  | { type: 'VIEW_DELETED'; viewId: string }
  | { type: 'VIEW_UPDATED'; viewId: string; updates: Partial<View> }
  | { type: 'VIEW_CRASHED'; viewId: string; details: any }
  | { type: 'ACTIVE_VIEW_CHANGED'; viewId: string | null }
  | { type: 'ACTIVE_TASK_CHANGED'; taskId: string | null }
  | { type: 'AGENT_CREATED'; agent: Agent }
  | { type: 'AGENT_DELETED'; agentId: string }
  | { type: 'AGENT_STATUS_CHANGED'; agentId: string; status: Agent['status'] };

/**
 * IPC command types
 */
export interface CreateTaskCommand {
  title?: string;
  initialUrl?: string;
}

export interface AddPageCommand {
  taskId: string;
  url: string;
}

export interface SelectPageCommand {
  taskId: string;
  pageId: string;
}

export interface DeleteTaskCommand {
  taskId: string;
}

export interface DeletePageCommand {
  taskId: string;
  pageId: string;
}

export interface SetViewBoundsCommand {
  viewId: string;
  bounds: Rectangle;
}

export interface NavigateCommand {
  pageId: string;
  url: string;
}