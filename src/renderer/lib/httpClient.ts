import { getApiBase } from "@/lib/api";
import { AUTH_UNAUTHORIZED_EVENT } from "@/lib/authClient";

/**
 * Minimal HTTP client for the local backend (REST over the API base URL
 * resolved in lib/api — absolute in Electron, relative when served remotely).
 *
 * Transport model (MCP "Streamable HTTP" style):
 * - simple RPC       -> postJSON (response is JSON)
 * - streamed result  -> postStream (response body is a ReadableStream)
 * - fire-and-forget  -> postCommand (expects 2xx, body ignored)
 * - real deletions   -> delete
 *
 * Server-initiated push is handled separately by {@link ../serverEvents},
 * which manages a single EventSource on GET /events.
 *
 * Same-origin requests carry the session cookie automatically; a 401 (expired
 * session) is broadcast so the AuthGate can drop back to the login screen.
 */
class HttpClient {
  private jsonHeaders = { "Content-Type": "application/json" };

  private async send(path: string, init?: RequestInit): Promise<Response> {
    const res = await fetch(`${getApiBase()}${path}`, init);
    if (res.status === 401) {
      window.dispatchEvent(new CustomEvent(AUTH_UNAUTHORIZED_EVENT));
    }
    return res;
  }

  async getJSON<T>(path: string): Promise<T> {
    const res = await this.send(path);
    if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
    return (await res.json()) as T;
  }

  async postJSON<T>(path: string, body?: unknown): Promise<T> {
    const res = await this.send(path, {
      method: "POST",
      headers: this.jsonHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
    return (await res.json()) as T;
  }

  /** Fire-and-forget command; expects 2xx, body ignored. */
  async postCommand(path: string, body?: unknown): Promise<void> {
    const res = await this.send(path, {
      method: "POST",
      headers: this.jsonHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
  }

  async delete(path: string, body?: unknown): Promise<void> {
    const res = await this.send(path, {
      method: "DELETE",
      headers: this.jsonHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`DELETE ${path} failed: ${res.status}`);
  }

  /** POST whose response is a stream (e.g. streamed-request endpoints). */
  async postStream(
    path: string,
    body?: unknown,
  ): Promise<ReadableStream<Uint8Array>> {
    const res = await this.send(path, {
      method: "POST",
      headers: this.jsonHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok || !res.body) {
      throw new Error(`POST ${path} failed: ${res.status}`);
    }
    return res.body;
  }
}

export const httpClient = new HttpClient();
