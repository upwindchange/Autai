# Store Signing & CI

The manual (`workflow_dispatch`) store job in `.github/workflows/build.yml`
builds and signs Mac App Store (`.pkg`) and Microsoft Store (`.appx`)
packages. Store submission itself stays manual: download artifacts from the
run and upload to App Store Connect / Partner Center.

## Secret setup (`store-signing` environment)

All store-signing secrets are **environment secrets**, not repository
secrets. Both store jobs declare `environment: store-signing`, so add the
secrets below to that environment (name matching matters; `secrets.NAME`
resolves environment first, then falls back to any same-named repository
secret).

Create it once: **Settings → Environments → New environment →
`store-signing`**, then **Add environment secret** for each row you need:

| Secret | Job | When |
|---|---|---|
| `MAC_APP_P12_BASE64` | mac-store | always |
| `MAC_APP_P12_PASSWORD` | mac-store | always |
| `MAC_INSTALLER_P12_BASE64` | mac-store | always |
| `MAC_INSTALLER_P12_PASSWORD` | mac-store | always |
| `MAS_PROVISION_BASE64` | mac-store | optional |
| `AZURE_TENANT_ID` | windows-store | Option A (Azure) |
| `AZURE_CLIENT_ID` | windows-store | Option A (Azure) |
| `AZURE_CLIENT_SECRET` | windows-store | Option A (Azure) |
| `AZURE_SIGNING_CERTIFICATE_NAME` | windows-store | Option A (Azure) |
| `WIN_CERT_BASE64` | windows-store | Option B (classic EV) |
| `WIN_CERT_PASSWORD` | windows-store | Option B (classic EV) |
| `APPX_PUBLISHER` | windows-store | always |

For Windows signing pick **exactly one** of Option A / Option B — the
workflow uses the classic cert only when `WIN_CERT_BASE64` is set and
`AZURE_CLIENT_ID` is not (see the `windows-store` job's `if` conditions).

Recommended environment settings (also under the environment page):

- **Deployment branches and tags → Restricted** — allow `master` and `v*`
  tags, so a workflow edited on a random branch can never reach the
  signing secrets.
- **Required reviewers** (optional) — a human approval click before the
  signing material lands on a runner; fits the already-manual dispatch.

Don't duplicate these names as repository secrets: environment secrets
take precedence, but a stale repo-level copy invites confusion. `GITHUB_TOKEN`
stays automatic and needs no setup.

## Mac App Store

Signing requires an Apple Developer Program membership and **two** different
certificates — do not confuse them:

- **"3rd Party Mac Developer Application"** — signs the `.app` (this is what
  MAS builds need).
- **"3rd Party Mac Developer Installer"** — signs the `.pkg` installer.

electron-builder 26.15.3 matches by certificate CN, and the two roles
differ in what they accept (verified against the installed source):

- MAS `.app` signing accepts **either** `Apple Distribution:` **or**
  `3rd Party Mac Developer Application:` (`MacTargetHelper.js` —
  `["Apple Distribution", "3rd Party Mac Developer Application"]`).
- MAS `.pkg` signing (`createMasInstaller`) hard-codes
  `"3rd Party Mac Developer Installer"` — a `Mac Installer Distribution:`
  cert **cannot** be matched, even via an explicit `identity` qualifier or
  `CSC_NAME` (`_findIdentity` requires the prefix inside the identity
  name; see upstream PR #9226, unmerged).

The portal's Type column (`Mac App Distribution` /
`Mac Installer Distribution`) no longer reveals the CN — check the p12s
directly (the Type column and the CN can disagree; the profile wizard
filters by certificate policy, which is why a Type-matching cert may not
be offered there):

```bash
openssl pkcs12 -in app.p12 -nokeys -passin pass:PW | openssl x509 -noout -subject
openssl pkcs12 -in installer.p12 -nokeys -passin pass:PW | openssl x509 -noout -subject
# app:      "3rd Party Mac Developer Application" or "Apple Distribution" — both OK
# installer: MUST say "3rd Party Mac Developer Installer" with builder 26.15.3
```

Both portal certs expire 2027-06-08. **Verified 2026-08-26**: both CI
secret p12s carry the legacy CNs (`3rd Party Mac Developer Application:`
/ `3rd Party Mac Developer Installer:`, issued 2026-06-08) — fully
compatible with builder 26.15.3 as-is; the workaround below is only for
future renewals (re-check with the commands above after any re-issue).
Renewed portal certs may carry the modern `Mac Installer Distribution:`
CN, in which case pkg signing will fail (workaround: patch
`MacTargetHelper.js` in CI after `pnpm install`, replacing the
hard-coded legacy name with `Mac Installer Distribution`).

Each cert is exported as its own `.p12` (see the `~/apple-signing/mac`
README for the openssl CSR/p12 procedure). The workflow imports both into
one temporary keychain; `electron-builder` picks the right identity for each
phase automatically.

### Secrets

| Secret | Value |
|---|---|
| `MAC_APP_P12_BASE64` | `base64 -w 0 mac/app/app.p12` ("3rd Party Mac Developer Application") |
| `MAC_APP_P12_PASSWORD` | password of the app `.p12` |
| `MAC_INSTALLER_P12_BASE64` | `base64 -w 0 mac/installer/installer.p12` ("3rd Party Mac Developer Installer") |
| `MAC_INSTALLER_P12_PASSWORD` | password of the installer `.p12` (independent of the app one) |
| `MAS_PROVISION_BASE64` | `base64 -w 0 < embedded.provisionprofile` generated on the Apple Developer portal (**optional** — no `provisioningProfile` in `electron-builder.json`; the workflow step is `if`-guarded. Try a dispatch without it: builds sign fine. Add it only if App Store Connect upload validation rejects the pkg) |

> Why it exists at all: a provisioning profile ties bundle id + team +
allowed signing certs together and carries the sandbox entitlement grants;
MAS apps use it for App Store **receipt validation**. First-time sandboxed
submissions are where its absence is most often flagged.

The build uses `build/entitlements.mas.plist`: sandbox + network
(client AND server — the app's renderer↔main link is localhost HTTP/SSE)
+ user-selected file access + the V8 keys (JIT, unsigned executable
memory). Sandbox is mandatory for MAS; network and file access are NOT
allowed by default once sandboxed — add entitlements there as needed
(e.g. `com.apple.security.print`, device access).

Create the profile on the **Apple Developer portal** — not App Store Connect
(App Store Connect has no Profiles page; that's why you won't find it there):
developer.apple.com → Account → Certificates, Identifiers & Profiles →
Profiles → **+** → type **Mac App Store Connect** → select the App ID
`ai.autai.app` → Continue.

The Configure step may report "No Certificates are available" even though
the Certificates tab shows a valid `Mac App Distribution` cert (portal
filter quirk). The rule that matters: **the profile must embed the exact
cert the app is signed with**. So, after any Create Certificate detour,
refresh the Select Certificates screen:

- **Old ("3rd Party Mac Developer Application", created 2026-06-08) cert
  listed → select IT.** No p12 change, no secret update; the downloaded
  `.cer` from the detour is then redundant (keep for renewal or discard).
  Preferred: the existing CI secrets are verified working.
- **Only the new cert listed → select it**, then re-export the app p12
  (below) so signing cert == profile cert. The old p12 keeps working
  until the profile switches; this is the only reason to re-export.

Create Certificate detour (only if the old cert truly can't be selected):

1. **Create Certificate** → type **Mac App Distribution**. Apple allows
   **one** distribution cert of each type per team — if it reports the
   limit reached, revoke the existing `Mac App Distribution` row first
   (leave the installer cert untouched), then immediately re-export the
   replacement p12 and update `MAC_APP_P12_BASE64` before the next
   dispatch, since revocation invalidates the old cert chain.
2. Upload the **existing** `~/apple-signing/mac/app.certSigningRequest`
3. Download the issued `.cer`; refresh the wizard, select the cert →
   Continue → Generate → Download the `.provisionprofile`.
4. Re-export the app `.p12` from the same private key + new cert
   (`openssl pkcs12 -export`, same password) and update
   `MAC_APP_P12_BASE64` — App Store validation requires the signing
   identity to match the embedded profile cert. The resulting
   `Apple Distribution:` CN is fine for MAS app signing (only the
   installer cert must keep its legacy CN — do NOT also create a
   "Mac Installer Distribution" cert).
5. `base64 -w 0 <name>.provisionprofile` → `MAS_PROVISION_BASE64`.


## Renewing after expiry

Certs (issued ~1-year, current pair valid to 2027-06-08) only gate NEW
signing — published store apps and installed copies are unaffected. The
renewal reuses the existing private keys; no new CSR is needed and no repo
or workflow change is required:

1. Apple Developer portal → Certificates → create a new cert, uploading the
   **same** `app.certSigningRequest` / `installer.certSigningRequest` from
   `~/apple-signing/mac/`. Portal names: "Mac App Distribution" (app) /
   "Mac Installer Distribution" (installer) — these are the renamed
   equivalents of the legacy types; the issued cert may carry the new
   `Mac Installer Distribution:` CN, which `createMasInstaller` cannot
   match (see the note above). If the renewed installer cert gets the new
   CN, patch `node_modules/app-builder-lib/out/codeSign/macSign` or pin a
   fixed electron-builder version; verify with the `openssl x509 -subject`
   check before uploading secrets.
2. Convert the new `.cer` to PEM and confirm the public-key fingerprint
   still matches the private key (steps 4–5 / 7–8 of the local README).
3. Re-export the `.p12` files with the same password
   (`openssl pkcs12 -export ...`).
4. `base64 -w 0` each new `.p12` and update the `store-signing`
   environment secrets `MAC_APP_P12_BASE64` / `MAC_INSTALLER_P12_BASE64`.
5. Run the manual `mac-store` job; the `security find-identity` step should
   list both identities, then the build signs green.

Renew ahead of expiry: Apple allows a couple of concurrent certs per type,
so you can flip the secret and verify a green build while the old cert is
still valid, then revoke the old one. If the portal reports the limit
reached, revoke the expiring cert first. Only generate fresh keys/CSRs if
you suspect key compromise.

### Notes

- `electron-builder --mac mas` runs the `mas` config block in
  `electron-builder.json` (targets `pkg`, x64 + arm64).
- MAS builds **cannot enable hardened runtime** and use the Mac App Store
  entitlements instead — the config sets `hardenedRuntime: false`,
  `gatekeeperAssess: false` for this reason.
- CI runs on `macos-latest`; codesign/productbuild are present there.
- The `afterPack` hook treats `mas` as `darwin` for the better-sqlite3
  prebuild, so store builds get the same Node-API binary as regular mac
  builds. Rebuilding against Electron ABI is unnecessary (v13 is Node-API).

## Microsoft Store

Two signing options; Azure Trusted Signing is the modern path (no cert
files, auto-renewing):

### Option A — Azure Trusted Signing (recommended)

1. Create a Trusted Signing account in Azure (`Trusted Signing Accounts`).
2. Create a certificate profile; its name goes in
   `AZURE_SIGNING_CERTIFICATE_NAME`.
3. Create an Entra service principal with access; set
   `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`.
4. Onboarding individual validation happens on Microsoft's side (org
   validation, ~days). Individual developers: see
   https://learn.microsoft.com/en-us/azure/trusted-signing/ .

electron-builder detects the `AZURE_*` env trio and uses Azure signing
instead of signtool with a local cert (its `windowsSignAzureManager`).

### Option B — classic EV code-signing certificate

Export as `.p12`, then:

| Secret | Value |
|---|---|
| `WIN_CERT_BASE64` | `base64 < cert.p12` |
| `WIN_CERT_PASSWORD` | `.p12` password |

The workflow writes it to disk and points `CSC_LINK` at it.

### Publisher (both options)

| Secret | Value |
|---|---|
| `APPX_PUBLISHER` | Publisher/Identity string from Partner Center → Product → Product identity, e.g. `CN=XXXXXXXX-XXXX-...` |

For appx, publisher **must match** what Partner Center shows, or the package
is rejected on upload.

### Notes

- Target: `electron-builder --win appx`. `.appx` output is uploaded to
  Partner Center manually (or via their HTTP submission API later).
- Runs on `windows-latest` — signtool and the appx packaging toolchain are
  present.
- The `afterPack` hook stamps `win32-{x64,arm64}.node` as usual; Node-API
  prebuilts need no ABI-specific rebuild.

## Local dry-run (unsigned)

`pnpm exec electron-builder --mac mas` / `--win appx` run locally without
secrets — output is unsigned. Useful for catching packaging errors before
burning a CI run.
