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
      invoke(channel: "threadview:created", threadId: string): Promise<IPCResult>;
      invoke(channel: "threadview:switched", threadId: string): Promise<IPCResult>;
      invoke(channel: "threadview:deleted", threadId: string): Promise<IPCResult>;
      invoke(channel: "threadview:getActiveView", threadId: string): Promise<{ success: boolean; data?: string | null }>;

      // View operations
      invoke(channel: "threadview:setVisibility", args: { viewId: string; isVisible: boolean }): Promise<IPCResult>;
      invoke(channel: "threadview:setBounds", args: { viewId: string; bounds: { x: number; y: number; width: number; height: number } }): Promise<IPCResult>;
      
      // Debug operations
      invoke(channel: "debug:threadview:navigateTo", args: { viewId: string; url: string }): Promise<IPCResult>;
      invoke(channel: "debug:threadview:refresh", args: { viewId: string }): Promise<IPCResult>;
      invoke(channel: "debug:threadview:goBack", args: { viewId: string }): Promise<{ success: boolean; data?: boolean; error?: string }>;
      invoke(channel: "debug:threadview:goForward", args: { viewId: string }): Promise<{ success: boolean; data?: boolean; error?: string }>;
      invoke(channel: "debug:threadview:setVisibility", args: { viewId: string; isVisible: boolean }): Promise<IPCResult>;
      invoke(channel: "debug:threadview:setBounds", args: { viewId: string; bounds: { x: number; y: number; width: number; height: number } }): Promise<IPCResult>;

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
