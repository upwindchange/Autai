/**
 * AuthService — single-user password auth for Remote Access mode.
 *
 * The password is never stored in plaintext and never transmitted. The owner
 * (configuring from the desktop, which reaches the backend over loopback) sends
 * only a PBKDF2-derived key; everyone else proves knowledge of the password via
 * a one-time HMAC challenge. See src/shared/auth.ts for the protocol.
 *
 * The password hash lives in the `settings` key-value table (key
 * `auth_password`), deliberately outside SettingsState so GET /settings never
 * serializes it. Sessions live in the `auth_sessions` table.
 */

import crypto from "node:crypto";
import { eq, lt } from "drizzle-orm";
import log from "electron-log/main";
import { getDb } from "@/db";
import { settings, authSessions } from "@/db/schema";
import { settingsService } from "./settingsService";
import type { AuthChallenge } from "@shared";

const logger = log.scope("AuthService");

export const SESSION_COOKIE = "session";
const DAY_MS = 24 * 60 * 60 * 1000;
// Sentinel for non-expiring sessions (auth_sessions.expiresAt is NOT NULL text).
// 100y is effectively "forever"; the browser cookie maxAge is Int32-capped below.
const FOREVER_MS = 100 * 365 * DAY_MS;
const FOREVER_COOKIE_SEC = 10 * 365 * 24 * 60 * 60;
const CHALLENGE_TTL_MS = 60 * 1000; // 60s to use a nonce

// Online brute-force bound: per-IP attempt bucket over a rolling minute.
const LOGIN_WINDOW_MS = 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 10;

const PASSWORD_KEY = "auth_password";

interface PasswordRecord {
  salt: string;
  iters: number;
  derivedKey: string;
}

class AuthService {
  private password: PasswordRecord | null = null;
  // nonce -> expiresAt. Single-use: deleted on first verification attempt.
  private challenges = new Map<string, number>();
  // ip -> { count, resetAt }. Bounds login attempts per network client.
  private attempts = new Map<string, { count: number; resetAt: number }>();

  initialize(): void {
    this.loadPassword();
    this.purgeExpiredSessions();
    logger.info(
      this.password ?
        "remote auth armed (owner password configured)"
      : "remote auth inactive (no owner password configured)",
    );
  }

  hasPassword(): boolean {
    return this.password !== null;
  }

  /** Set or replace the owner password. Invalidates all existing sessions. */
  setPassword(rec: PasswordRecord): void {
    const db = getDb();
    const value = JSON.stringify(rec);
    db.insert(settings)
      .values({ key: PASSWORD_KEY, value })
      .onConflictDoUpdate({ target: settings.key, set: { value } })
      .run();
    this.password = rec;
    this.destroyAllSessions();
    logger.info("owner password set; all sessions invalidated");
  }

  /** Remove the owner password. Disables auth and invalidates all sessions. */
  clearPassword(): void {
    const db = getDb();
    db.delete(settings).where(eq(settings.key, PASSWORD_KEY)).run();
    this.password = null;
    this.destroyAllSessions();
    logger.info("owner password cleared");
  }

  /** Issue a single-use challenge. Caller must ensure a password is configured. */
  createChallenge(): AuthChallenge {
    const nonce = crypto.randomBytes(16).toString("base64");
    this.challenges.set(nonce, Date.now() + CHALLENGE_TTL_MS);
    this.gcChallenges();
    logger.debug("challenge issued");
    return {
      nonce,
      salt: this.password!.salt,
      iters: this.password!.iters,
    };
  }

  /**
   * Verify a login proof. Returns a fresh session token on success, or null on
   * any failure (no password, rate-limited, bad/expired nonce, wrong proof).
   * Each outcome is logged at debug to make auth failures diagnosable.
   */
  verifyLogin(ip: string, nonce: string, proof: string): string | null {
    if (!this.password) {
      logger.debug("login denied: no password configured");
      return null;
    }
    if (!this.takeAttempt(ip)) {
      logger.debug("login denied: rate-limited", { ip });
      return null;
    }

    // Single-use: consume the nonce regardless of outcome so it can't be replayed.
    const expiresAt = this.challenges.get(nonce);
    this.challenges.delete(nonce);
    if (expiresAt === undefined || expiresAt <= Date.now()) {
      logger.debug("login denied: invalid or expired nonce", { ip });
      return null;
    }

    const expected = crypto
      .createHmac("sha256", Buffer.from(this.password.derivedKey, "base64"))
      .update(Buffer.from(nonce, "base64"))
      .digest("base64");
    const got = Buffer.from(proof);
    const want = Buffer.from(expected);
    if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) {
      logger.debug("login denied: bad proof", { ip });
      return null;
    }
    logger.debug("login accepted", { ip });
    return this.createSession();
  }

  /** Validate a presented token without refreshing it (hot path: every request). */
  validateSession(token: string | null | undefined): boolean {
    const tokenHash = this.hashToken(token);
    if (!tokenHash) return false;
    const db = getDb();
    const row = db
      .select()
      .from(authSessions)
      .where(eq(authSessions.tokenHash, tokenHash))
      .get();
    if (!row) return false;
    if (new Date(row.expiresAt).getTime() <= Date.now()) {
      db.delete(authSessions)
        .where(eq(authSessions.tokenHash, tokenHash))
        .run();
      return false;
    }
    // Sliding refresh, throttled: only rewrite once past half-life — and only
    // when expiry is enabled (non-expiring sessions never need refreshing).
    const ttl = this.getTtlMs();
    if (ttl > 0 && new Date(row.expiresAt).getTime() - Date.now() < ttl / 2) {
      db.update(authSessions)
        .set({ expiresAt: new Date(Date.now() + ttl).toISOString() })
        .where(eq(authSessions.tokenHash, tokenHash))
        .run();
    }
    return true;
  }

  /**
   * Configured session lifetime in ms. Reads live settings: when expiry is
   * disabled (sessionExpires=false) returns 0, which callers treat as "never".
   */
  private getTtlMs(): number {
    const { sessionExpires, sessionTtlDays } = settingsService.settings;
    return sessionExpires ? sessionTtlDays * DAY_MS : 0;
  }

  destroySession(token: string | null | undefined): void {
    const tokenHash = this.hashToken(token);
    if (!tokenHash) return;
    getDb()
      .delete(authSessions)
      .where(eq(authSessions.tokenHash, tokenHash))
      .run();
  }

  destroyAllSessions(): void {
    getDb().delete(authSessions).run();
  }

  get sessionCookieName(): string {
    return SESSION_COOKIE;
  }

  get sessionMaxAge(): number {
    const ttl = this.getTtlMs();
    return ttl > 0 ? Math.round(ttl / 1000) : FOREVER_COOKIE_SEC;
  }

  private loadPassword(): void {
    const db = getDb();
    const row = db
      .select()
      .from(settings)
      .where(eq(settings.key, PASSWORD_KEY))
      .get();
    if (!row) {
      this.password = null;
      return;
    }
    try {
      const parsed = JSON.parse(row.value) as Partial<PasswordRecord>;
      this.password =
        parsed.salt && parsed.iters && parsed.derivedKey ?
          {
            salt: parsed.salt,
            iters: parsed.iters,
            derivedKey: parsed.derivedKey,
          }
        : null;
    } catch {
      logger.warn("auth_password row was malformed; ignoring");
      this.password = null;
    }
  }

  private createSession(): string {
    const token = crypto.randomBytes(32).toString("base64url");
    const now = Date.now();
    const ttl = this.getTtlMs();
    const expiresAfter = ttl > 0 ? ttl : FOREVER_MS;
    const db = getDb();
    db.insert(authSessions)
      .values({
        tokenHash: this.hashToken(token)!,
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + expiresAfter).toISOString(),
      })
      .run();
    return token;
  }

  private hashToken(token: string | null | undefined): string | null {
    if (!token) return null;
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  private purgeExpiredSessions(): void {
    const now = new Date().toISOString();
    getDb().delete(authSessions).where(lt(authSessions.expiresAt, now)).run();
  }

  private gcChallenges(): void {
    const now = Date.now();
    for (const [n, exp] of this.challenges) {
      if (exp <= now) this.challenges.delete(n);
    }
  }

  /** Increment the per-IP attempt counter; returns false if over the limit. */
  private takeAttempt(ip: string): boolean {
    const now = Date.now();
    let bucket = this.attempts.get(ip);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + LOGIN_WINDOW_MS };
      this.attempts.set(ip, bucket);
    }
    bucket.count++;
    return bucket.count <= MAX_LOGIN_ATTEMPTS;
  }
}

export const authService = new AuthService();
