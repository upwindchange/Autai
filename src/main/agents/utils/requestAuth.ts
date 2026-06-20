/**
 * Hono request helpers for remote-access auth. Shared by the ApiServer auth
 * middleware and the /auth routes.
 */
import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { authService } from "@/services";

// @hono/node-server attaches the Node request/response to c.env. We only need
// the socket's remote address for rate-limiting and loopback owner detection.
interface NodeServerEnv {
  incoming?: { socket?: { remoteAddress?: string } };
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/** Read the session token from the cookie, falling back to a Bearer header. */
export function getSessionToken(c: Context): string | undefined {
  const cookie = getCookie(c, authService.sessionCookieName);
  if (cookie) return cookie;
  const auth = c.req.header("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  return undefined;
}

export function getRemoteAddress(c: Context): string {
  const env = c.env as NodeServerEnv | undefined;
  return env?.incoming?.socket?.remoteAddress ?? "unknown";
}

/**
 * The desktop owner loads the renderer from a local file and reaches the
 * backend over loopback (getApiBase() is always http://127.0.0.1:<port>).
 * Exempt exactly those requests — gated on BOTH a loopback source address and a
 * loopback Host header, so DNS-rebinding (a remote page resolved to 127.0.0.1)
 * is rejected (its Host would be the attacker's domain, not loopback).
 */
export function isLocalOwner(c: Context): boolean {
  const addr = getRemoteAddress(c);
  if (!addr || !LOOPBACK.has(addr)) return false;
  const host = (c.req.header("host") ?? "").split(":")[0];
  return host === "127.0.0.1" || host === "localhost";
}

/**
 * Paths reachable without a session so an unauthenticated remote browser can
 * load the SPA shell + assets and perform the login handshake. Everything else
 * (all API data routes, SSE) requires the owner (loopback) or a valid session.
 */
export function isPublicPath(method: string, path: string): boolean {
  if (path === "/health") return true;
  if (
    path === "/auth/login" ||
    path === "/auth/status" ||
    path === "/auth/challenge"
  ) {
    return true;
  }
  if (method === "GET") {
    if (path === "/" || path === "/index.html") return true;
    if (path.startsWith("/assets/")) return true;
    if (/\.(?:js|css|svg|png|jpe?g|ico|webp|woff2?|map|json)$/.test(path)) {
      return true;
    }
  }
  return false;
}
