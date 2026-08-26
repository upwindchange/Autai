# CI/CD Setup Reminders

Status: Mac secrets (`MAC_APP_P12_BASE64`, `MAC_APP_P12_PASSWORD`,
`MAC_INSTALLER_P12_BASE64`, `MAC_INSTALLER_P12_PASSWORD`) are already in the
`store-signing` environment. Remaining items:

## 1. Windows store job secrets (or disable it)

`workflow_dispatch` defaults `build_appx: true`, and none of its secrets
exist yet. Either uncheck **Build Microsoft Store package** when
dispatching, or add to the `store-signing` environment:

- **Option A (Azure Trusted Signing, recommended):**
  `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`,
  `AZURE_SIGNING_CERTIFICATE_NAME`
- **Option B (classic EV `.p12`):** `WIN_CERT_BASE64`, `WIN_CERT_PASSWORD`
- **Always:** `APPX_PUBLISHER` — exact publisher string from Partner Center
  → Product → Product identity (e.g. `CN=XXXXXXXX-XXXX-...`). Appx is
  rejected on upload if it doesn't match.

Pick exactly one of Option A / Option B; the workflow's `if` conditions
choose based on which secrets are present.

## 2. `MAS_PROVISION_BASE64` — optional; try CI without it first

The workflow's `electron-builder.json` sets no `provisioningProfile`, and
the "Write provisioning profile" step is `if`-guarded on the secret being
present. **Dispatch with the secret absent to test CI today** — MAS builds
sign with the verified certs regardless. Only add it if App Store Connect
upload validation rejects the pkg (common for sandboxed apps on first
submission). To add later: Apple Developer portal → Account →
Certificates, Identifiers & Profiles → Profiles → **+** → type
**Mac App Store Connect** → App ID `ai.autai.app` → select the
"3rd Party Mac Developer Application" cert → Generate → Download. Then:

```bash
base64 -w 0 <name>.provisionprofile   # paste as secret (Linux: no pbcopy)
```

## 3. Environment protection (Settings → Environments → `store-signing`)

- **Deployment branches → Restricted** — allow `master` and `v*` tags.
  Without this, any branch can reach the signing certs.
- **Required reviewers** (optional) — each dispatch pauses for a manual
  approval click before secrets are exposed.

Note: with branch restriction on, the dispatch must run from `master`
(the default).

## 4. Regular build/tag jobs — nothing to do

`GITHUB_TOKEN` is automatic; the workflow already grants `contents: write`
for the draft release on tag push.

## 5. Local dry-run before burning a CI run

Unsigned local packaging check per `docs/store-signing.md`:

```bash
pnpm exec electron-vite build && pnpm exec electron-builder --mac mas --publish never
```

## Minimal path to a green dispatch now

Untick `build_appx`, run the dispatch from `master`. The Mac cert pair uses
the legacy `3rd Party Mac Developer …` names (verified 2026-08, valid to
2027-06), so `security find-identity` should list both identities and the
MAS build should sign.
