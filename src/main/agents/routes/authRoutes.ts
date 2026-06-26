import { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import log from "electron-log/main";
import { authService, settingsService } from "@/services";
import {
  isLocalOwner,
  getRemoteAddress,
  getSessionToken,
} from "../utils/requestAuth";
import {
  LoginRequestSchema,
  SetPasswordRequestSchema,
  type AuthStatus,
} from "@shared";

const logger = log.scope("ApiServer:Auth");
export const authRoutes = new Hono();

// GET /auth/status — lets the UI decide whether to render the login screen.
authRoutes.get("/status", (c) => {
  const authRequired =
    settingsService.settings.serverMode === "remote" &&
    authService.hasPassword();
  const authenticated =
    isLocalOwner(c) ||
    (authService.hasPassword() &&
      authService.validateSession(getSessionToken(c)));
  const status: AuthStatus = {
    authRequired,
    authenticated,
    passwordSet: authService.hasPassword(),
  };
  logger.debug("status", status);
  return c.json(status);
});

// GET /auth/challenge — single-use nonce + PBKDF2 params to derive the key.
authRoutes.get("/challenge", (c) => {
  if (!authService.hasPassword()) {
    return c.json({ error: "No password configured" }, 400);
  }
  return c.json(authService.createChallenge());
});

// POST /auth/login — verify the one-time proof, issue a session token.
authRoutes.post("/login", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = LoginRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid login request" }, 400);
  }
  const token = authService.verifyLogin(
    getRemoteAddress(c),
    parsed.data.nonce,
    parsed.data.proof,
  );
  if (!token) {
    return c.json({ error: "Invalid credentials" }, 401);
  }
  setCookie(c, authService.sessionCookieName, token, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: authService.sessionMaxAge,
  });
  logger.info("session issued", { ip: getRemoteAddress(c) });
  return c.json({ ok: true, token });
});

// POST /auth/logout — drop this client's session and clear the cookie.
authRoutes.post("/logout", (c) => {
  authService.destroySession(getSessionToken(c));
  deleteCookie(c, authService.sessionCookieName, { path: "/" });
  return c.json({ ok: true });
});

// POST /auth/password — set/replace the owner password (loopback owner only).
authRoutes.post("/password", async (c) => {
  if (!isLocalOwner(c)) return c.json({ error: "Forbidden" }, 403);
  const body = await c.req.json().catch(() => null);
  const parsed = SetPasswordRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: "Invalid password payload", details: parsed.error.issues },
      400,
    );
  }
  authService.setPassword(parsed.data);
  return c.json({ ok: true });
});

// DELETE /auth/password — remove the owner password (loopback owner only).
authRoutes.delete("/password", (c) => {
  if (!isLocalOwner(c)) return c.json({ error: "Forbidden" }, 403);
  authService.clearPassword();
  return c.json({ ok: true });
});
