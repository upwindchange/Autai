/**
 * Core data types shared between main and renderer processes
 */

export interface Page {
  id: string;
  url: string;
  title: string;
  favicon: string;
}

export interface Task {
  id: string;
  title: string;
  pages: Map<string, Page>; // pageId -> Page
  activePageId: string | null;
}

export interface View {
  id: string;
  taskId: string;
  pageId: string;
}

export interface Agent {
  id: string;
  taskId: string;
  processId: number;
  status: "idle" | "processing" | "error" | "terminated";
  createdAt: number;
}

export interface AppState {
  tasks: Record<string, Task>;
  views: Record<string, View>;
  agents: Record<string, Agent>;
  activeTaskId: string | null;
  activeViewId: string | null;
}
