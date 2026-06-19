/// <reference types="vite/client" />

// The renderer reaches the backend exclusively over HTTP/SSE (httpClient /
// serverEvents). The API base URL is resolved from the ?apiPort= search param
// (Electron) or via same-origin relative URLs when the UI is served by the
// backend itself.

export {};
