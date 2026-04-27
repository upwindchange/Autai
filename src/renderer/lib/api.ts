let cachedBase: string | null = null;

export async function initApiBase(): Promise<void> {
  const port = await window.ipcRenderer.invoke("get-api-port");
  cachedBase = `http://127.0.0.1:${port}`;
}

export function getApiBase(): string {
  if (!cachedBase)
    throw new Error("API base not initialized. Call initApiBase() first.");
  return cachedBase;
}
