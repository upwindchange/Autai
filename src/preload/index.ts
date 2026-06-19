// Preload is intentionally a no-op.
//
// The renderer reaches the backend exclusively over HTTP/SSE (httpClient /
// serverEvents), and the API port is passed via the load URL (?apiPort=) rather
// than IPC. With no IPC surface exposed, contextBridge has nothing to inject —
// this file exists only because Electron still references a preload path.
// Enabling sandbox:true in BrowserWindow is now safe (tracked separately).
export {};
