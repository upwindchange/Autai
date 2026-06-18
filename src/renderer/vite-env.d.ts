/// <reference types="vite/client" />

// The preload (@electron-toolkit/preload) exposes a generic `ipcRenderer` on
// window. Only the deferred `get-api-port` bootstrap still uses it; all other
// channels now go through the HTTP/SSE transport (httpClient / serverEvents).
declare global {
  interface Window {
    ipcRenderer: {
      invoke(channel: string, ...args: unknown[]): Promise<unknown>;
      on(channel: string, listener: (...args: unknown[]) => void): void;
      once(channel: string, listener: (...args: unknown[]) => void): void;
      off(channel: string, listener?: (...args: unknown[]) => void): void;
      send(channel: string, ...args: unknown[]): void;
    };
  }
}

export {};
