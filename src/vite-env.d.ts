/// <reference types="vite/client" />

// Import types from electron/shared
import type {
  IpcRendererEvent,
  SettingsState,
  TestConnectionConfig,
  TestConnectionResult,
} from "@shared/index";
import { Rectangle } from "electron";

// Generic result type for IPC operations
interface IPCResult {
  success: boolean;
  error?: string;
}

// Type-safe IPC API
declare global {
  interface Window {
    ipcRenderer: {
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
      invoke(channel: "settings:get"): Promise<SettingsState>;
      invoke(channel: "settings:isConfigured"): Promise<boolean>;

      // Thread operations
      invoke(
        channel: "threadview:getActiveView",
        threadId: string
      ): Promise<{ success: boolean; data?: string | null }>;

      // Generic invoke (fallback)
      invoke(channel: string, ...args: unknown[]): Promise<unknown>;

      // Event listeners
      on(
        channel: string,
        listener: (event: IpcRendererEvent, ...args: unknown[]) => void
      ): void;

      once(
        channel: string,
        listener: (event: IpcRendererEvent, ...args: unknown[]) => void
      ): void;

      off(channel: string, listener?: (...args: unknown[]) => void): void;

      // Send operations (rarely used in renderer)
      send(channel: string, ...args: unknown[]): void;

      // Thread operations
      send(channel: "threadview:created", threadId: string): void;
      send(channel: "threadview:switched", threadId: string): void;
      send(channel: "threadview:deleted", threadId: string): void;

      // View operations
      send(
        channel: "threadview:setVisibility",
        args: { isVisible: boolean }
      ): void;
      send(channel: "threadview:setBounds", args: { bounds: Rectangle }): void;

      // Debug operations
      send(
        channel: "debug:threadview:navigateTo",
        args: { viewId: string; url: string }
      ): void;
      send(channel: "debug:threadview:refresh", args: { viewId: string }): void;
      send(channel: "debug:threadview:goBack", args: { viewId: string }): void;
      send(
        channel: "debug:threadview:goForward",
        args: { viewId: string }
      ): void;
      send(
        channel: "debug:threadview:setVisibility",
        args: { viewId: string; isVisible: boolean }
      ): void;
      send(
        channel: "debug:threadview:setBounds",
        args: { bounds: Rectangle }
      ): void;
    };
  }
}

export {};
