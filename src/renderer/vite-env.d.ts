/// <reference types="vite/client" />

// Import types from electron/shared
import type { IpcRendererEvent, AppMessage, LogLevel } from "@shared";
import { Rectangle } from "electron";

// Type-safe IPC API
declare global {
  interface Window {
    ipcRenderer: {
      // Thread operations
      invoke(
        channel: "sessiontab:getActiveTab",
        threadId: string,
      ): Promise<{ success: boolean; data?: string | null }>;

      // Generic invoke (fallback)
      invoke(channel: string, ...args: unknown[]): Promise<unknown>;

      // Event listeners
      on(
        channel: string,
        listener: (event: IpcRendererEvent, ...args: unknown[]) => void,
      ): void;

      once(
        channel: string,
        listener: (event: IpcRendererEvent, ...args: unknown[]) => void,
      ): void;

      off(channel: string, listener?: (...args: unknown[]) => void): void;
      off(
        channel: "app:message",
        listener: (event: IpcRendererEvent, message: AppMessage) => void,
      ): void;

      // Send operations (rarely used in renderer)
      send(channel: string, ...args: unknown[]): void;

      // Thread operations
      send(channel: "sessiontab:created", threadId: string): void;
      send(channel: "sessiontab:switched", threadId: string): void;
      send(channel: "sessiontab:deleted", threadId: string): void;

      // View operations
      send(
        channel: "sessiontab:setVisibility",
        args: { isVisible: boolean },
      ): void;
      send(channel: "sessiontab:setBounds", args: { bounds: Rectangle }): void;

      // Error handling events
      on(
        channel: "app:message",
        listener: (event: IpcRendererEvent, message: AppMessage) => void,
      ): void;

      // Logger operations
      invoke(channel: "logger:setLevel", level: LogLevel): Promise<void>;
      invoke(channel: "logger:getLogPath"): Promise<string>;
      invoke(channel: "logger:clearLogs"): Promise<void>;

      // HITL operations
      invoke(
        channel: "hitl:respond",
        response: { id: string; response: unknown },
      ): Promise<void>;
    };
  }
}

export {};
