# Mobile client authentication

This document describes how a future native mobile client authenticates
directly against the Autai backend — **without** using the web login page. The
mobile app collects the password in its own native UI and talks to the same
`/auth/*` REST endpoints the web UI uses.

It is a companion to the web implementation in
[authClient.ts](../src/renderer/lib/authClient.ts) and the server logic in
[authService.ts](../src/main/services/authService.ts). The shared contract lives
in [src/shared/auth.ts](../src/shared/auth.ts).

## TL;DR

1. The owner configures a password from the desktop app (Settings → Connection →
   Authentication) while in **Remote Access** mode. The mobile app **never** sets
   the password — it only logs in.
2. App asks the backend for a one-time challenge, derives a key from the user's
   password (PBKDF2-SHA256), and replies with an HMAC proof. **The raw password is
   never sent.**
3. On success the backend returns a **bearer token** (also set as a cookie for
   browsers, which the mobile app ignores). Store it; send it as
   `Authorization: Bearer <token>` on every request.
4. A token is valid for the configured lifetime (default 30 days, sliding; the
   owner can also disable expiry entirely). On `401`, re-authenticate.

## Background: why challenge–response

The backend is reached over **plain HTTP** (a LAN IP such as
`http://192.168.1.5:8787`). Sending the password in cleartext, or even a static
hash of it, would be replayable by anyone on the network. Instead the login is a
challenge–response:

- The server holds `derivedKey = PBKDF2-SHA256(password, salt, iters)` (stored
  one-way; the plaintext password is never persisted).
- Each login, the server issues a **single-use nonce**. The client proves it knows
  the password by computing `HMAC-SHA256(derivedKey, nonce)` — a value that is
  unique per login and useless to replay.

A captured login proves nothing: the nonce is spent after one attempt, and HMAC
is one-way so the `derivedKey` (and thus the password) cannot be recovered.

## Prerequisites

- The backend is running in **Remote Access** mode and is reachable from the
  device at some `BASE_URL` (e.g. `http://192.168.1.5:8787`). The user enters this
  in the app. There is **no TLS** — see [Security notes](#security-notes).
- A password has been configured by the owner. Confirm with
  `GET /auth/status`; if `passwordSet` is false, auth is not active and every
  request is open (the app can still call APIs without a token in that state).

## Authentication flow

```
Mobile                          Backend
  │                               │
  │  GET /auth/status             │
  │ ─────────────────────────────▶│  { authRequired, authenticated, passwordSet }
  │ ◀─────────────────────────────│
  │                               │
  │  GET /auth/challenge          │
  │ ─────────────────────────────▶│  { nonce, salt, iters }   (nonce single-use, 60s TTL)
  │ ◀─────────────────────────────│
  │                               │
  │  derive key + compute proof   │
  │  (see Crypto, below)          │
  │                               │
  │  POST /auth/login             │
  │   { nonce, proof }            │
  │ ─────────────────────────────▶│  verifies proof, issues session
  │ ◀─────────────────────────────│  { ok: true, token }  (+ Set-Cookie, ignored by mobile)
  │                               │
  │  store token (secure storage) │
  │                               │
  │  GET /threads                 │
  │   Authorization: Bearer token │
  │ ─────────────────────────────▶│  200
  │ ◀─────────────────────────────│
```

## Endpoint reference

All paths are relative to `BASE_URL`. Request/response shapes are defined in
[src/shared/auth.ts](../src/shared/auth.ts).

### `GET /auth/status` — public

```json
{ "authRequired": true, "authenticated": false, "passwordSet": true }
```

- `authRequired` — `true` when Remote mode is on **and** a password is set. If
  `false`, no auth is needed; the app can call any API without a token.
- Call this on startup (and to detect session expiry). With a valid bearer token
  it returns `authenticated: true`.

### `GET /auth/challenge` — public

```json
{ "nonce": "<base64>", "salt": "<base64>", "iters": 200000 }
```

- `400` if no password is configured.
- The `nonce` is **single-use**: it is consumed by the next `/auth/login` attempt
  (success or failure) and expires after ~60s. Request a fresh challenge per
  login attempt.

### `POST /auth/login` — public

Request:

```json
{ "nonce": "<the exact base64 nonce string from the challenge>",
  "proof": "<base64 HMAC-SHA256(derivedKey, nonce)>" }
```

Response (`200`):

```json
{ "ok": true, "token": "<base64url bearer token>" }
```

- `401` on any failure (wrong password, expired/reused nonce, rate-limited). The
  body does **not** distinguish the cause — request a new challenge and retry.
- The response also sets a `session` cookie for browsers. The mobile app should
  ignore the cookie and use `token` from the JSON body.

### `POST /auth/logout` — authenticated

Clears this client's session. Send the bearer token. Response: `{ "ok": true }`.

> `POST /auth/password` and `DELETE /auth/password` are **owner-only** (the
> desktop app over loopback) and return `403` to any network/mobile client. The
> mobile app never calls them.

## Crypto

This is the critical part for interop — the derived value must match the server
exactly. All binary fields (`nonce`, `salt`, `proof`) are **standard base64
strings (with padding, no newlines)**.

```
# 1. Derive the key from the password (once per login)
derivedKey = PBKDF2-HMAC-SHA256(
  password = UTF-8 bytes of the user's password,
  salt     = base64-decode(challenge.salt),
  iterations = challenge.iters,            # 200000
  dkLen    = 32                            # 256 bits
)                                          # -> 32 raw bytes

# 2. Compute the one-time proof
proofBytes = HMAC-SHA256(
  key     = derivedKey,                    # the 32 bytes above
  message = base64-decode(challenge.nonce) # the raw nonce bytes
)                                          # -> 32 raw bytes
proof = base64-encode(proofBytes)          # standard base64, with padding
```

Rules that are easy to get wrong:

- Decode `salt` and `nonce` from base64 to **bytes** before use. Do not feed the
  base64 strings into PBKDF2/HMAC as text.
- Send back the **original** `nonce` string from the challenge in the login
  request (the server looks the session up by it). Do not re-encode the decoded
  nonce.
- Use **standard base64 with padding** for `proof` (no URL-safe alphabet, no line
  breaks). The server decodes with Node `Buffer.from(proof, "base64")`.
- Use **PBKDF2 with HMAC-SHA256** as the PRF (not SHA-1 or SHA-512).

The constant `iters` currently defaults to **200 000** (`PBKDF2_ITERATIONS` in
[src/shared/auth.ts](../src/shared/auth.ts)), but **always use the `iters` value
returned by the challenge** — it can differ per configured password.

### Reference pseudocode

```text
function login(password):
    ch  = GET /auth/challenge                  # { nonce, salt, iters }
    dk  = PBKDF2_HMAC_SHA256(utf8(password), b64decode(ch.salt), ch.iters, 32)
    prf = b64encode(HMAC_SHA256(dk, b64decode(ch.nonce)))
    res = POST /auth/login { nonce: ch.nonce, proof: prf }
    if not res.ok: raise InvalidCredentials
    store_securely(res.token)
```

### Kotlin (Android)

Uses only the platform `javax.crypto` APIs — no third-party libraries.

```kotlin
import android.util.Base64
import javax.crypto.Mac
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

fun computeProof(password: String, saltB64: String, iters: Int, nonceB64: String): String {
    val salt = Base64.decode(saltB64, Base64.DEFAULT)
    val nonce = Base64.decode(nonceB64, Base64.DEFAULT)

    // PBKDF2-HMAC-SHA256 -> 32 bytes
    val spec = PBEKeySpec(password.toCharArray(), salt, iters, 32 * 8)
    val derivedKey = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
        .generateSecret(spec).encoded

    // HMAC-SHA256(derivedKey, nonce) -> base64
    val mac = Mac.getInstance("HmacSHA256").apply {
        init(SecretKeySpec(derivedKey, "HmacSHA256"))
    }
    return Base64.encodeToString(mac.doFinal(nonce), Base64.NO_WRAP)
}
```

### Swift (iOS)

PBKDF2 comes from CommonCrypto; HMAC-SHA256 from CryptoKit.

```swift
import CommonCrypto
import CryptoKit
import Foundation

enum AuthError: Error { case derivationFailed }

func computeProof(password: String, saltB64: String, iters: Int, nonceB64: String) throws -> String {
    let salt = Data(base64Encoded: saltB64)!
    let nonce = Data(base64Encoded: nonceB64)!
    let pwBytes = Array(password.utf8)

    // PBKDF2-HMAC-SHA256 -> 32 bytes
    var derivedKey = Data(count: 32)
    let status = derivedKey.withUnsafeMutableBytes { (dkPtr: UnsafeMutableRawBufferPointer) -> Int32 in
        salt.withUnsafeBytes { saltPtr in
            CCKeyDerivationPBKDF(
                CCPBKDFAlgorithm(kCCPBKDF2),
                pwBytes, pwBytes.count,
                saltPtr.baseAddress?.assumingMemoryBound(to: UInt8.self), salt.count,
                CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256),
                UInt32(iters),
                dkPtr.baseAddress?.assumingMemoryBound(to: UInt8.self), 32
            )
        }
    }
    guard status == kCCSuccess else { throw AuthError.derivationFailed }

    // HMAC-SHA256(derivedKey, nonce) -> base64
    let mac = HMAC<SHA256>.authenticationCode(for: nonce, using: SymmetricKey(data: derivedKey))
    return Data(mac).base64EncodedString()
}
```

## Using the token

After a successful login, persist `token` in the platform secure store
(Android **EncryptedSharedPreferences** / iOS **Keychain`). Send it on every
request:

```
Authorization: Bearer <token>
```

The backend accepts the token in **either** the `Authorization: Bearer` header
**or** the `session` cookie — the mobile app should use the header and ignore the
cookie.

### Token lifecycle

- **Configurable, sliding expiry.** The owner sets the session lifetime in the
  desktop Settings (Connection → Authentication): a number of days (default 30),
  or expiration **disabled** so sessions never expire. When enabled, each
  authenticated request refreshes the expiry (the server rewrites it once past
  half-life), so regular use keeps the session alive. The mobile app can't read
  or change this setting — it just observes whatever the server enforces.
- **Stored hashed.** The DB stores `sha256(token)`, so a device backup/DB read
  does not reveal live tokens.
- **Invalidation.** Changing or removing the password from the desktop deletes
  **all** sessions — every device must re-authenticate. A `401` on a previously
  valid token means: the session expired or was invalidated → run `login()` again.

### Handling 401

Treat `401` from any endpoint (except `/auth/login` itself) as "session invalid":

1. Discard the stored token.
2. Re-prompt for the password (or show the app's login screen).
3. Call `login()` again.

There is **no refresh token** — the bearer token is the only credential, and
re-authentication requires the password.

## Rate limiting

`POST /auth/login` is rate-limited to **10 attempts per source IP per 60s window**.
Exceeding it returns `401` (indistinguishable from a wrong password). The app
should:

- Surface a generic "incorrect password" on `401` (do not imply rate-limiting —
  that would leak state).
- Back off after a few failures rather than hammering the endpoint.

A single device almost never hits the limit with correct use; it exists to bound
online password guessing.

## Security notes

- **Plain HTTP.** The protocol protects the password (never sent) and prevents
  replay (single-use nonce), but the bearer token itself travels in cleartext on
  the header. On an untrusted network an eavesdropper could capture and reuse a
  live token until it expires. For hostile networks, run the backend behind a TLS
  reverse proxy or a VPN/Tailscale — the client code is unchanged (`BASE_URL`
  becomes `https://…`).
- **Store the token securely** (Keychain / EncryptedSharedPreferences), never in
  plain shared preferences or logs.
- **Do not log** the password, `derivedKey`, nonce, proof, or token.
- The owner's plaintext password is never stored on the server; only the
  PBKDF2-derived key is, and PBKDF2 is one-way.

## Minimal end-to-end example (HTTP)

```text
# 1. Challenge
GET /auth/challenge
-> { "nonce": "ab…==", "salt": "cd…==", "iters": 200000 }

# 2. Compute proof on-device (see Crypto), then:
POST /auth/login
Content-Type: application/json
{ "nonce": "ab…==", "proof": "ef…==" }
-> { "ok": true, "token": "g_hIj…" }     # base64url

# 3. Authenticated request
GET /threads
Authorization: Bearer g_hIj…
-> 200 [ … ]
```
