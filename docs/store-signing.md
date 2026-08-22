# Store Signing & CI

`.github/workflows/build-store.yml` (manual `workflow_dispatch`) builds and
signs Mac App Store (`.pkg`) and Microsoft Store (`.appx`) packages. Store
submission itself stays manual: download artifacts from the run and upload to
App Store Connect / Partner Center.

## Mac App Store

Signing requires an Apple Developer Program membership and **two** different
certificates — do not confuse them:

- **"3rd Party Mac Developer Application"** — signs the `.app` (this is what
  MAS builds need).
- **"3rd Party Mac Developer Installer"** — signs the `.pkg` installer.

Both live in the same exported `.p12`. The workflow imports it into a
temporary keychain; `electron-builder` picks the right identity for each
phase automatically.

### Secrets

| Secret | Value |
|---|---|
| `MAC_CERT_BASE64` | `base64 < AppleDistribution.p12` — containing *both* 3rd-party certificates above |
| `MAC_CERT_PASSWORD` | password of that `.p12` |
| `MAS_PROVISION_BASE64` | `base64 < embedded.provisionprofile` from App Store Connect (optional; omit to build unsigned-profile pkgs) |

Export the `.p12` in Keychain Access (select the *private key*, export as
`.p12`). Create the provisioning profile in App Store Connect →
Certificates, Identifiers & Profiles → Profiles (type: Mac App Store) with
the app's bundle id `com.upwindchange.Autai`.

The build uses `build/entitlements.mas.plist` (JIT + unsigned executable
memory — required by Electron's V8). Add store-specific entitlements there
if you need them (e.g. network access is allowed by default; file access
outside the sandbox requires explicit entries).

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
