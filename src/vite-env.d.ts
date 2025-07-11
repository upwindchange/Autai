/// <reference types="vite/client" />

interface Window {
  // expose in the `electron/preload/index.ts`
  ipcRenderer: import('electron').IpcRenderer
}

// AI Chat API types
interface AIApiResponse {
  response: string;
  action?: {
    type: string;
    elementId?: number;
  };
}

// Type-safe IPC API extensions for AI functionality
declare global {
  interface Window {
    ipcRenderer: {
      invoke(channel: 'genai:send', message: string): Promise<string>;
      invoke(channel: 'ai:processCommand', command: string, viewKey: string): Promise<AIApiResponse>;
      invoke(channel: 'ai:getInteractables', viewKey: string): Promise<unknown[]>;
      invoke(channel: 'ai:clickElement', viewKey: string, elementId: number): Promise<boolean>;
      invoke(channel: 'settings:load'): Promise<{ profiles: Array<{ id: string; name: string; settings: { apiUrl: string; apiKey: string; complexModel: string; simpleModel: string; }; createdAt: Date; updatedAt: Date; }>; activeProfileId: string; }>;
      invoke(channel: 'settings:save', settings: { profiles: Array<{ id: string; name: string; settings: { apiUrl: string; apiKey: string; complexModel: string; simpleModel: string; }; createdAt: Date; updatedAt: Date; }>; activeProfileId: string; }): Promise<{ success: boolean }>;
      invoke(channel: 'settings:test', config: { apiUrl: string; apiKey: string; model: string }): Promise<{ success: boolean; message: string }>;
      invoke(channel: 'settings:getActive'): Promise<{ apiUrl: string; apiKey: string; complexModel: string; simpleModel: string; } | null>;
      invoke(channel: 'settings:isConfigured'): Promise<boolean>;
      invoke(channel: 'view:hideAll'): Promise<void>;
      invoke(channel: 'view:show', key: string): Promise<void>;
      invoke(channel: 'view:getVisible'): Promise<string | null>;
      invoke(channel: string, ...args: unknown[]): Promise<unknown>;
      on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void;
      once(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void;
      off(channel: string, listener?: (...args: unknown[]) => void): void;
      send(channel: string, ...args: unknown[]): void;
    };
  }
}
