import type {
  Task,
  View,
  Agent,
  AppState,
  StateChangeEvent,
} from "../../electron/shared/types";
import type { RefObject } from "react";

// Core state that syncs with backend
export interface CoreState {
  tasks: Map<string, Task>;
  views: Map<string, View>;
  agents: Map<string, Agent>;
  activeTaskId: string | null;
  activeViewId: string | null;
}

// UI-only state
export interface UIState {
  isViewHidden: boolean;
  containerRef: RefObject<HTMLDivElement | null> | null;
  containerBounds: DOMRect | null;
  showSettings: boolean;
}


// Backend operations
export interface BackendActions {
  createTask: (title?: string, initialUrl?: string) => Promise<void>;
  deleteTask: (taskId: string) => Promise<void>;
  addPage: (taskId: string, url: string) => Promise<void>;
  deletePage: (taskId: string, pageId: string) => Promise<void>;
  selectPage: (taskId: string, pageId: string) => Promise<void>;
  navigate: (taskId: string, pageId: string, url: string) => Promise<void>;
}

// UI operations
export interface UIActions {
  setViewVisibility: (isHidden: boolean) => void;
  setContainerRef: (ref: RefObject<HTMLDivElement | null>) => void;
  updateContainerBounds: () => void;
  setShowSettings: (show: boolean) => void;
}

// State sync actions
export interface SyncActions {
  syncState: (state: AppState) => void;
  handleStateChange: (event: StateChangeEvent) => void;
  retryInitialization: () => Promise<void>;
}

// Navigation actions
export interface NavigationActions {
  goBack: (taskId: string, pageId: string) => Promise<void>;
  goForward: (taskId: string, pageId: string) => Promise<void>;
  reload: (taskId: string, pageId: string) => Promise<void>;
  stop: (taskId: string, pageId: string) => Promise<void>;
}

// Combined AppStore interface
export interface AppStore extends 
  CoreState, 
  UIState, 
  BackendActions,
  UIActions,
  SyncActions,
  NavigationActions {}