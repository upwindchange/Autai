/**
 * Client side of the remote-access auth protocol (see src/shared/auth.ts).
 *
 * The raw password is never sent. On login the server hands us a one-time nonce
 * plus the PBKDF2 params; we derive the key from the password and respond with
 * an HMAC proof. Setting the password computes the same derived key locally.
 *
 * IMPORTANT: we use @noble/hashes (pure JS), NOT window.crypto.subtle. SubtleCrypto
 * is only available in secure contexts (HTTPS / localhost), but remote browsers
 * reach this app over plain HTTP from a LAN IP — where crypto.subtle is undefined.
 * The same algorithm (PBKDF2-SHA256 + HMAC-SHA256) is what the server (Node
 * crypto) and the future mobile client use.
 */
import { pbkdf2 } from "@noble/hashes/pbkdf2.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { getApiBase } from "@/lib/api";
import {
  PBKDF2_ITERATIONS,
  type AuthChallenge,
  type AuthStatus,
} from "@shared";

export const AUTH_UNAUTHORIZED_EVENT = "auth:unauthorized";

export async function getAuthStatus(): Promise<AuthStatus> {
  const res = await fetch(`${getApiBase()}/auth/status`);
  return (await res.json()) as AuthStatus;
}

export async function login(password: string): Promise<boolean> {
  const challenge = (await (
    await fetch(`${getApiBase()}/auth/challenge`)
  ).json()) as AuthChallenge;

  const derivedKey = pbkdf2(
    sha256,
    new TextEncoder().encode(password),
    base64ToBytes(challenge.salt),
    { c: challenge.iters, dkLen: 32 },
  );
  const proof = toBase64(
    hmac(sha256, derivedKey, base64ToBytes(challenge.nonce)),
  );

  const res = await fetch(`${getApiBase()}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nonce: challenge.nonce, proof }),
  });
  // The server sets the session cookie on success; same-origin requests carry
  // it automatically from here on.
  return res.ok;
}

export async function logout(): Promise<void> {
  await fetch(`${getApiBase()}/auth/logout`, { method: "POST" });
}

/** Set or replace the owner password. Owner only (loopback); computed locally. */
export async function setPassword(password: string): Promise<boolean> {
  const salt = toBase64(crypto.getRandomValues(new Uint8Array(16)));
  const derivedKey = pbkdf2(
    sha256,
    new TextEncoder().encode(password),
    base64ToBytes(salt),
    { c: PBKDF2_ITERATIONS, dkLen: 32 },
  );
  const res = await fetch(`${getApiBase()}/auth/password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      salt,
      iters: PBKDF2_ITERATIONS,
      derivedKey: toBase64(derivedKey),
    }),
  });
  return res.ok;
}

export async function clearPassword(): Promise<boolean> {
  const res = await fetch(`${getApiBase()}/auth/password`, {
    method: "DELETE",
  });
  return res.ok;
}

// ---- encoding helpers (work in any context, including non-secure HTTP) ----

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
