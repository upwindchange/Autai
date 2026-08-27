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
| `MAS_PROVISION_BASE64` | mac-store | **set 2026-08-27** |
| `AZURE_TENANT_ID` | windows-store | optional (additive signing) |
| `AZURE_CLIENT_ID` | windows-store | optional (additive signing) |
| `AZURE_CLIENT_SECRET` | windows-store | optional (additive signing) |
| `AZURE_SIGNING_CERTIFICATE_NAME` | windows-store | optional (additive signing) |

Status: all five mac secrets are set. The `AZURE_*` rows below remain
unset and **unneeded** — Partner Center re-signs uploaded appx packages,
and the identity the Store validates (`identityName` / `publisher`)
lives in `electron-builder.json` `appx.*`, not in secrets. They exist
only for the optional additive Authenticode signing (Microsoft Store
section); set them only if that is ever enabled.

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
| `MAS_PROVISION_BASE64` | `base64 -w 0 < embedded.provisionprofile` from the Apple Developer portal — **set 2026-08-27**. No `provisioningProfile` key in `electron-builder.json`; the workflow's write step is `if`-guarded on the secret, so a future dispatch with the secret removed silently reverts to profile-less builds |

> Why it exists: a provisioning profile ties bundle id + team + allowed
> signing certs together and carries the sandbox entitlement grants; MAS
> apps use it for App Store **receipt validation**.
> Profile renewal rides along with cert renewal (see below).

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
or workflow change is required. **The provisioning profile must also be
regenerated** against the renewed app cert (profiles embed a specific
cert; they do not survive cert renewal):

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
5. Regenerate the provisioning profile (portal → Profiles → **+** →
   Mac App Store Connect → App ID `ai.autai.app` → select the renewed
   app cert) and update `MAS_PROVISION_BASE64` with
   `base64 -w 0 <name>.provisionprofile`.
6. Run the manual `mac-store` job; the `security find-identity` step should
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

**Short answer: you do not need a code-signing certificate.** Microsoft
Store MSIX/APPX submissions are re-signed by the Store with a Microsoft
certificate during ingestion — no CA cert, no `.pfx`, no USB token, no
Azure account (see "Code signing for Microsoft Store submissions" in
https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-package-requirements ).
CA signing is only required for MSI/EXE installers or sideloaded MSIX,
which this repo doesn't ship.

### Package identity (the part that IS mandatory)

The AppxManifest `Identity` must byte-for-byte match Partner Center →
Product → Product identity (values are case-sensitive; verified against
this product 2026-08-26). These live in `electron-builder.json` `appx.*`,
not in CI secrets:

| `appx.` key | Value | Partner Center field |
|---|---|---|
| `identityName` | `YuweiZhu.Autai` | Package/Identity/Name |
| `publisher` | `CN=36582D6A-6F9D-4D61-8B74-8CABAC43E1A2` | Package/Identity/Publisher |
| `publisherDisplayName` | `Yuwei Zhu` | Package/Properties/PublisherDisplayName |

The remaining identity values from that page (PFN
`YuweiZhu.Autai_61x5jjmwq5462`, Package SID, Store ID `9PPB6S1X5CBT`)
are derived by the Store — nothing to configure.

Store logo assets live in `build/appx/` (`StoreLogo.png`,
`Square44x44Logo.png`, `Square150x150Logo.png`, `Wide310x150Logo.png`,
plus `Square44x44Logo.targetsize-88.png` and `SplashScreen.png` — the
splash filename must contain the case-sensitive substring `SplashScreen`
or electron-builder's `splashScreenTag` skips the manifest element).
Without them electron-builder embeds Microsoft's SampleAppx placeholders,
which fail store certification. `appx.languages` pins the manifest
resource languages (`en-US`, `zh-Hans` — declare English + Chinese
(Simplified) in the Partner Center listing to match). Package version
`1.0.0` in package.json maps to appx `1.0.0.0` (4th quad reserved for
the Store, must be 0) — keep the npm version three-part.

### Build & submit

1. Dispatch the workflow (Actions → Build → Run workflow, tick
   `build_appx`) → download the `appx-packages` artifact.
2. Partner Center → the Autai product → Start submission → Packages →
   upload the `.appx` (a single arch package is fine; per-arch packages
   may share a version).
3. The Store re-signs on ingestion; your uploaded signature (none, if
   unsigned) is discarded.

Store submission stays manual — like App Store Connect, it is a review
process (certification typically hours–3 days for a first submission).

### Optional: additive Authenticode signing (Azure Trusted Signing)

If you later want a real signature on the shipped package (e.g. the same
binary also distributed outside the Store), sign additionally with Azure
Artifact Signing (formerly Trusted Signing). Config-driven, not env-driven:

1. Azure Portal → Trusted Signing account (identity validation required;
   orgs: US/CA/EU/UK, **individuals: US/CA only** — an individual outside
   those regions cannot onboard; skip this section) → certificate profile.
2. Entra app registration with the Certificate Profile Signer role →
   `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`
   environment secrets (the PS module reads them at sign time).
3. Add to `electron-builder.json` (the manager activates only when this
   block exists; electron-builder 26.15.3 reads no `AZURE_*` env itself —
   `winPackager.js` selects `WindowsSignAzureManager` on
   `azureSignOptions != null`):

   ```json
   "win": {
     "azureSignOptions": {
       "endpoint": "https://<region>.codesigning.azure.net/",
       "codeSigningAccountName": "<account>",
       "certificateProfileName": "<profile>",
       "publisherName": "CN=36582D6A-6F9D-4D61-8B74-8CABAC43E1A2"
     }
   }
   ```

   `azureSignOptions.publisherName` must stay the Partner Center publisher
   (the Azure manager takes the appx manifest publisher from it, not from
   `appx.publisher`). The workflow already exports the `AZURE_*` env
   secrets to the build step. Note Trusted Signing signs Windows 10 1809+.

Classic EV `.p12` (old Option B) remains possible via `WIN_CERT_BASE64` /
`WIN_CERT_PASSWORD`-style `CSC_LINK` setup if you ever switch to NSIS/MSI
distribution, but it is dead config for pure Store appx flow — not set up.

### Notes

- Target: `electron-builder --win appx` (unsigned; Store re-signs).
- Runs on `windows-latest` — makeappx/signtool toolchain present.
- The `afterPack` hook stamps `win32-{x64,arm64}.node` as usual; Node-API
  prebuilts need no ABI-specific rebuild.
- If the same package is ever signed by both Azure and the classic cert
  path, remove the other's config — `windowsCodeSign` warns when both
  `azureSignOptions` and `signtoolOptions` are set.

## Local dry-run (unsigned)

`pnpm exec electron-builder --mac mas` runs locally on a mac without
secrets (output unsigned). `--win appx` requires a Windows (or mac) host —
the appx target refuses Linux (`AppX is supported only on Windows 10 or
Windows Server 2012 R2`); use the CI job as the appx dry-run. Useful for
catching packaging errors before burning a CI run.
