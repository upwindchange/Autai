/// <reference types="vite/client" />

// Import types from electron/shared
import type {
  CreateTaskCommand,
  DeleteTaskCommand,
  AddPageCommand,
  DeletePageCommand,
  SelectPageCommand,
  SetViewBoundsCommand,
  SetViewVisibilityCommand,
  StreamMessageCommand,
  ClearHistoryCommand,
  NavigationControlCommand,
  NavigateCommand,
  NavigationResult,
  AppState,
  StateChangeEvent,
  StreamChunk,
  SettingsState,
  AISettings,
  TestConnectionConfig,
  TestConnectionResult,
} from "../electron/shared/types/index";

// Generic result type for IPC operations
interface IPCResult {
  success: boolean;
  error?: string;
}

// Type-safe IPC API
declare global {
  interface Window {
    ipcRenderer: {
      // Task operations
      invoke(
        channel: "app:createTask",
        command: CreateTaskCommand
      ): Promise<IPCResult>;
      invoke(
        channel: "app:deleteTask",
        command: DeleteTaskCommand
      ): Promise<IPCResult>;
      invoke(
        channel: "app:addPage",
        command: AddPageCommand
      ): Promise<IPCResult>;
      invoke(
        channel: "app:deletePage",
        command: DeletePageCommand
      ): Promise<IPCResult>;
      invoke(
        channel: "app:selectPage",
        command: SelectPageCommand
      ): Promise<IPCResult>;

      // Navigation operations
      invoke(
        channel: "app:navigate",
        command: NavigateCommand
      ): Promise<NavigationResult>;
      invoke(
        channel: "app:navigationControl",
        command: NavigationControlCommand
      ): Promise<NavigationResult>;

      // View operations
      invoke(
        channel: "app:setViewBounds",
        command: SetViewBoundsCommand
      ): Promise<IPCResult>;
      invoke(
        channel: "app:setViewVisibility",
        command: SetViewVisibilityCommand
      ): Promise<IPCResult>;
      invoke(
        channel: "app:getInteractableElements",
        command: { viewId: string; viewportOnly?: boolean }
      ): Promise<unknown[]>;
      invoke(
        channel: "app:clickElement",
        command: { viewId: string; elementId: number; viewportOnly?: boolean }
      ): Promise<boolean>;

      // AI operations
      invoke(
        channel: "ai:streamMessage",
        command: StreamMessageCommand
      ): Promise<string>;
      invoke(
        channel: "ai:clearHistory",
        command: ClearHistoryCommand
      ): Promise<IPCResult>;
      invoke(
        channel: "ai:removeAgent",
        command: { taskId: string }
      ): Promise<IPCResult>;
      invoke(
        channel: "ai:getHistory",
        command: { taskId: string }
      ): Promise<Array<{ content: string; role: string; timestamp: number }>>;
      invoke(channel: "ai:getActiveTasks"): Promise<string[]>;

      // Settings operations
      invoke(channel: "settings:load"): Promise<SettingsState>;
      invoke(
        channel: "settings:save",
        settings: SettingsState
      ): Promise<IPCResult>;
      invoke(
        channel: "settings:test",
        config: TestConnectionConfig
      ): Promise<TestConnectionResult>;
      invoke(channel: "settings:getActive"): Promise<AISettings | null>;
      invoke(channel: "settings:isConfigured"): Promise<boolean>;

      // State operations
      invoke(channel: "app:getState"): Promise<AppState>;
      invoke(
        channel: "app:setExpandedTask",
        taskId: string | null
      ): Promise<void>;

      // Generic invoke (fallback)
      invoke(channel: string, ...args: unknown[]): Promise<unknown>;

      // Event listeners
      on(
        channel: "state:sync",
        listener: (event: unknown, state: AppState) => void
      ): void;
      on(
        channel: "state:change",
        listener: (event: unknown, event: StateChangeEvent) => void
      ): void;
      on(
        channel: "task:deleted",
        listener: (event: unknown, taskId: string) => void
      ): void;
      on(
        channel: `ai:stream:${string}`,
        listener: (event: unknown, chunk: StreamChunk) => void
      ): void;
      on(
        channel: string,
        listener: (event: unknown, ...args: unknown[]) => void
      ): void;

      once(
        channel: `ai:stream:${string}:end`,
        listener: (event: unknown) => void
      ): void;
      once(
        channel: string,
        listener: (event: unknown, ...args: unknown[]) => void
      ): void;

      off(channel: string, listener?: (...args: unknown[]) => void): void;
      off(
        channel: `ai:stream:${string}`,
        listener: (event: unknown, chunk: StreamChunk) => void
      ): void;
      off(channel: `ai:stream:${string}:end`, listener: () => void): void;
      off(
        channel: "task:deleted",
        listener: (event: unknown, taskId: string) => void
      ): void;

      // Send operations (rarely used in renderer)
      send(channel: string, ...args: unknown[]): void;
    };
  }
}

export {};
