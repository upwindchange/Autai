let cachedBase: string | null = null;

// The main process appends ?apiPort=<port> to the load URL when the renderer
// runs inside Electron. When the UI is served by the backend itself (remote
// browser), no param is present and we fall back to same-origin relative URLs
// (empty base), so every `getApiBase()` consumer works unchanged in both cases.
export function initApiBase(): void {
  const port = new URLSearchParams(window.location.search).get("apiPort");
  cachedBase = port ? `http://127.0.0.1:${port}` : "";
}

export function getApiBase(): string {
  if (cachedBase === null)
    throw new Error("API base not initialized. Call initApiBase() first.");
  return cachedBase;
}
