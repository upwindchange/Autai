# CI/CD Setup Reminders

Status: **all `store-signing` environment secrets are set** — Mac cert
pair, passwords, and `MAS_PROVISION_BASE64` (added 2026-08-27). Nothing
pending on the Windows side (appx builds unsigned; Partner Center
re-signs — see docs/store-signing.md).

## 1. Environment protection — TODO (Settings → Environments → `store-signing`)

- **Deployment branches → Restricted** — allow `master` and `v*` tags.
  Without this, any branch can reach the signing certs.
- **Required reviewers** (optional) — each dispatch pauses for a manual
  approval click before secrets are exposed.
- With branch restriction on, dispatches must run from `master` (the
  default).

## 2. Dispatch & submit — TODO

Actions → Build → Run workflow, from `master`, both boxes ticked →
download `mas-packages` / `appx-packages` artifacts → upload `.pkg` to
App Store Connect and `.appx` to Partner Center. Listing content
(descriptions, screenshots, privacy policy URL, age ratings, AI-content
declarations) is portal-side work, not CI.

## 3. Contingencies — only if a run or upload fails

- **MAS signing/identity failure**: verify the p12 CNs with
  `openssl x509 -subject` (docs/store-signing.md) — the installer p12
  must keep its legacy `3rd Party Mac Developer Installer` CN.
- **App Store Connect rejects the pkg at upload validation**: first
  check that the provisioning profile's embedded cert == the app signing
  cert. If the profile was generated against a newly created cert (not
  the verified 2026-06-08 one), re-export the app `.p12` from that cert
  and update `MAC_APP_P12_BASE64` (details in docs/store-signing.md).

## 4. Local dry-run before burning a CI run

```bash
pnpm exec electron-vite build && pnpm exec electron-builder --mac mas --publish never
```
