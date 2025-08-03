/// <reference types="vite/client" />

// Import types from electron/shared
import type {
  IpcRendererEvent,
  SettingsState,
  AISettings,
  TestConnectionConfig,
  TestConnectionResult,
} from "@shared/index";

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
      invoke(channel: "settings:getActive"): Promise<AISettings | null>;
      invoke(channel: "settings:isConfigured"): Promise<boolean>;

      // Thread operations
      invoke(channel: "thread:created", threadId: string): Promise<IPCResult>;
      invoke(channel: "thread:switched", threadId: string): Promise<IPCResult>;
      invoke(channel: "thread:deleted", threadId: string): Promise<IPCResult>;
      invoke(channel: "thread:getActiveView", threadId: string): Promise<{ success: boolean; data?: string | null }>;

      // View operations
      invoke(channel: "view:setVisibility", args: { viewId: string; isVisible: boolean }): Promise<IPCResult>;
      invoke(channel: "view:setBounds", args: { viewId: string; bounds: { x: number; y: number; width: number; height: number } }): Promise<IPCResult>;

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
    };
  }
}

export {};
