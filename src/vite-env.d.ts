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
      invoke(channel: 'ai:getInteractables', viewKey: string): Promise<any[]>;
      invoke(channel: 'ai:clickElement', viewKey: string, elementId: number): Promise<boolean>;
      invoke(channel: string, ...args: any[]): Promise<any>;
      on(channel: string, listener: (event: any, ...args: any[]) => void): void;
      off(channel: string, listener?: (...args: any[]) => void): void;
      send(channel: string, ...args: any[]): void;
    };
  }
}
