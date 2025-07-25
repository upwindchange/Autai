/// <reference types="vite/client" />

// Import types from electron/shared
import type {
  SetViewBoundsCommand,
  SetViewVisibilityCommand,
  AppState,
  StateChangeEvent,
  SettingsState,
  AISettings,
  TestConnectionConfig,
  TestConnectionResult,
  // AuiThread types
  CreateAuiViewCommand,
  NavigateAuiViewCommand,
  SetAuiViewBoundsCommand,
  SetAuiViewVisibilityCommand,
  AuiView,
  AuiViewMetadata,
  AuiThreadViewState,
  AuiThreadEvent,
  AuiViewEvent,
} from "../electron/shared/types";

// Generic result type for IPC operations
interface IPCResult {
  success: boolean;
  error?: string;
}

// Type-safe IPC API
declare global {
  interface Window {
    ipcRenderer: {


      // View operations
      invoke(
        channel: "app:setViewBounds",
        command: SetViewBoundsCommand
      ): Promise<IPCResult>;
      invoke(
        channel: "app:setViewVisibility",
        command: SetViewVisibilityCommand
      ): Promise<IPCResult>;


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

      // AuiThread operations
      invoke(
        channel: "auiThread:created",
        threadId: string
      ): Promise<IPCResult>;
      invoke(
        channel: "auiThread:switched",
        threadId: string
      ): Promise<IPCResult>;
      invoke(
        channel: "auiThread:deleted",
        threadId: string
      ): Promise<IPCResult>;
      invoke(
        channel: "auiThread:getViews",
        threadId: string
      ): Promise<{ success: boolean; data?: AuiView[] }>;
      invoke(
        channel: "auiThread:getActiveView",
        threadId: string
      ): Promise<{ success: boolean; data?: string | null }>;
      invoke(
        channel: "auiThread:getState",
        threadId: string
      ): Promise<{ success: boolean; data?: AuiThreadViewState | null }>;

      // AuiView operations
      invoke(
        channel: "auiView:create",
        command: CreateAuiViewCommand
      ): Promise<{ success: boolean; data?: string; error?: string }>;
      invoke(
        channel: "auiView:navigate",
        command: NavigateAuiViewCommand
      ): Promise<IPCResult>;
      invoke(channel: "auiView:close", viewId: string): Promise<IPCResult>;
      invoke(
        channel: "auiView:setBounds",
        command: SetAuiViewBoundsCommand
      ): Promise<IPCResult>;
      invoke(
        channel: "auiView:setVisibility",
        command: SetAuiViewVisibilityCommand
      ): Promise<IPCResult>;
      invoke(
        channel: "auiView:setActive",
        viewId: string | null
      ): Promise<IPCResult>;
      invoke(
        channel: "auiView:getMetadata",
        viewId: string
      ): Promise<{ success: boolean; data?: AuiViewMetadata | null }>;

      // State operations
      invoke(channel: "app:getState"): Promise<AppState>;

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
        channel: "auiThread:event",
        listener: (event: unknown, event: AuiThreadEvent) => void
      ): void;
      on(
        channel: "auiView:event",
        listener: (event: unknown, event: AuiViewEvent) => void
      ): void;
      on(
        channel: string,
        listener: (event: unknown, ...args: unknown[]) => void
      ): void;

      once(
        channel: string,
        listener: (event: unknown, ...args: unknown[]) => void
      ): void;

      off(
        channel: "state:sync",
        listener: (event: unknown, state: AppState) => void
      ): void;
      off(
        channel: "state:change",
        listener: (event: unknown, event: StateChangeEvent) => void
      ): void;
      off(
        channel: "auiThread:event",
        listener: (event: unknown, event: AuiThreadEvent) => void
      ): void;
      off(
        channel: "auiView:event",
        listener: (event: unknown, event: AuiViewEvent) => void
      ): void;
      off(channel: string, listener?: (...args: unknown[]) => void): void;

      // Send operations (rarely used in renderer)
      send(channel: string, ...args: unknown[]): void;
    };
  }
}

export {};
