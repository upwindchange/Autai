/**
 * Auth types shared between main and renderer (and the future mobile client).
 *
 * Login uses a challenge–response protocol so the raw password is never stored
 * or transmitted — see AuthService in src/main/services/authService.ts.
 *
 *   client: derivedKey = PBKDF2(password, salt, iters)          // 32 bytes
 *           proof      = HMAC-SHA256(derivedKey, nonce)         // base64
 *   server: storedDerivedKey was set by the owner; recomputes the same HMAC
 *           over the single-use nonce and compares with timingSafeEqual.
 *
 * On success the server issues a session token: an HttpOnly cookie for browsers
 * (same-origin, so it rides every request) and the same token in the JSON body
 * for non-browser clients (mobile) to send as `Authorization: Bearer <token>`.
 */
import { z } from "zod";

// PBKDF2 parameters. The owner's client picks these when setting the password;
// they are echoed back in every challenge so every login derives the same key.
export const PBKDF2_ITERATIONS = 200_000;
export const PBKDF2_KEYLEN = 32; // 256-bit HMAC key, in bytes

// GET /auth/status — lets the UI decide whether to show the login screen.
export const AuthStatusSchema = z.object({
  /** Remote mode active AND a password is configured → requests are gated. */
  authRequired: z.boolean(),
  /** This client may proceed (loopback owner, or a valid session). */
  authenticated: z.boolean(),
  /** A password is currently configured (owner UI: set vs change vs remove). */
  passwordSet: z.boolean(),
});
export type AuthStatus = z.infer<typeof AuthStatusSchema>;

// GET /auth/challenge — a single-use nonce plus the params to derive the key.
export const AuthChallengeSchema = z.object({
  nonce: z.string(),
  salt: z.string(),
  iters: z.number().int().positive(),
});
export type AuthChallenge = z.infer<typeof AuthChallengeSchema>;

// POST /auth/login
export const LoginRequestSchema = z.object({
  nonce: z.string().min(1),
  proof: z.string().min(1),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const LoginResponseSchema = z.object({
  ok: z.boolean(),
  token: z.string(), // bearer token for mobile; browsers use the Set-Cookie instead
});
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

// POST /auth/password — set/replace the owner password. The derived key is
// computed client-side, so the raw password never leaves the owner's machine.
export const SetPasswordRequestSchema = z.object({
  salt: z.string(),
  iters: z.number().int().positive(),
  derivedKey: z.string(),
});
export type SetPasswordRequest = z.infer<typeof SetPasswordRequestSchema>;
