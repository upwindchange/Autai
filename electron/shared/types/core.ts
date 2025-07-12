/**
 * Core data types shared between main and renderer processes
 */

import type { Rectangle } from 'electron';

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

export interface AppState {
  tasks: Record<string, Task>;
  views: Record<string, View>;
  agents: Record<string, Agent>;
  activeTaskId: string | null;
  activeViewId: string | null;
}