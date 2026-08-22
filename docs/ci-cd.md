# CI/CD Infrastructure

Everything about how Autai builds, releases, and updates — what runs where,
where artifacts land, and the one-time GitHub setup you need.

## Map of the system

```
                    ┌──────────────────────────────────────────────┐
                    │ .github/workflows/build.yml  ("Build")       │
                    ├──────────────────────────────────────────────┤
  pull_request ────▶│ job: build (3-OS matrix)                     │
  tag push    ────▶│   PR:  package, upload artifacts              │
                    │   tag: package, upload to DRAFT GitHub       │
                    │        Release (manual publish = the gate)   │
                    │                                              │
  workflow_dispatch ▶│ job: mac-store      (signed .pkg, optional)  │
  (manual, toggles) │ job: windows-store  (signed .appx, optional) │
                    └──────────────────────────────────────────────┘
                                        │
              published GitHub Release │ artifact download (stores)
                                        ▼
                    ┌──────────────────────────────────────────────┐
                    │ src/main/update.ts (electron-updater)        │
                    │ installed apps auto-download new versions    │
                    └──────────────────────────────────────────────┘
```

- **Local, anytime**: `pnpm build` (current platform), `pnpm build:all`
  (all six OS/arch targets from one machine — see below for the wine caveat
  on Linux).
- **No dependency bots**: Dependabot was removed; you bump deps by hand.

## The Build workflow (`.github/workflows/build.yml`)

One workflow, three jobs, mutually exclusive by trigger:

| Job | Runs on | Trigger | Output |
|---|---|---|---|
| `build` | `macos-latest`, `ubuntu-latest`, `windows-latest` (matrix) | PR to `master`, or any tag push | PR: zips/installers as **workflow artifacts**. Tag: same installers uploaded to a **draft GitHub Release** |
| `mac-store` | `macos-latest` | Manual dispatch, `build_mas` ticked | Signed Mac App Store `.pkg` (x64 + arm64) as workflow artifact |
| `windows-store` | `windows-latest` | Manual dispatch, `build_appx` ticked | Signed Microsoft Store `.appx` as workflow artifact |

All jobs: pnpm 11 + Node 22 (`better-sqlite3` v13 requires ≥ 22), install
with `--no-frozen-lockfile` (lockfiles are gitignored in this repo),
`electron-vite build`, then `electron-builder`. The `afterPack` hook
(`scripts/after-pack.mjs`) stamps the correct Node-API prebuild into every
package, so no native rebuild ever runs in CI.

## Where builds are stored

Three different places depending on the pipeline — this trips people up:

### 1. Workflow artifacts (PRs and store jobs)

**GitHub → repo → Actions tab → click any run → scroll to "Artifacts"
section.**

- Named `release_<os>` (PR builds), `mas-packages`, `appx-packages`.
- Retention: **5 days** for PR artifacts (`retention-days: 5`); store
  artifacts use the repo default (90 days).
- Download = a zip of the `release/` output directory: installers plus
  `*-unpacked` folders for inspection.
- Authenticated GitHub users with repo access only — this is not a
  distribution channel.

### 2. GitHub Releases (tag pushes — the real distribution)

**GitHub → repo → Releases (or directly: `github.com/upwindchange/Autai/releases`)**

- Tag push → electron-builder creates a **draft** release containing every
  installer (NSIS exe, AppImage, mac zip) plus `latest*.yml` update feeds.
- Drafts are visible only to you. **Review it, then click "Publish
  release"** — that click is the release gate; nothing ships without it.
- Once published, this is what users download and what in-app updates read
  (next section).
- Recommended release flow:
  1. Bump `version` in `package.json`, commit.
  2. `git tag v0.0.6 && git push origin v0.0.6`.
  3. Wait for the Actions matrix to go green.
  4. Releases → draft → verify artifacts → **Publish**.

### 3. In-app auto-updates (users' machines)

`src/main/update.ts` runs `electron-updater` with `autoDownload = true`. It
fetches `latest.yml` (Windows) / `latest-linux.yml` / `latest-mac.yml` from
the **published** GitHub Releases and compares against the running version.
Higher version → download → toast prompt → restart to install.

Requirements already satisfied by the repo: `publish.provider: github` in
`electron-builder.json`, and `electron-updater` in dependencies.

## Store packages (manual dispatch)

Full secret-acquisition walkthrough (Apple p12s, provisioning profile,
Azure Trusted Signing vs classic EV cert, `APPX_PUBLISHER`): see
**[store-signing.md](./store-signing.md)**. Summary of what YOU must do on
the GitHub website, once:

1. **Settings → Secrets and variables → Actions → New repository secret**,
   add the store secrets listed in store-signing.md.
2. **Actions tab → Build → Run workflow** → tick the store targets → Run.
3. When green, download `mas-packages` / `appx-packages` artifacts and
   upload to App Store Connect / Partner Center in your browser. Submission
   to the stores stays manual on purpose — they are review processes.

## What exists vs what doesn't

| Capability | Have? | Where |
|---|---|---|
| Automatic build on PR/tag | ✅ | `build` job |
| Automatic installers to draft release | ✅ | `build` job, tag push |
| Manual publish gate | ✅ | GitHub Releases UI (by design) |
| In-app auto-update | ✅ | `src/main/update.ts` + published releases |
| Local all-platform packaging | ✅ | `pnpm build:all` (`scripts/build-all-platforms.mjs`) |
| Store package builds + signing | ✅ (needs one-time secrets) | `mac-store` / `windows-store` jobs |
| Automatic tagging / version bumps | ❌ | You tag manually (`git tag vX.Y.Z`) |
| Automatic PR labeling | ❌ | Not configured |
| Automatic store submission | ❌ | Manual upload to store portals |
| Dependency update bot | ❌ (removed on purpose) | — |

## Local builds (`pnpm build:all`)

`scripts/build-all-platforms.mjs` packages all six OS/arch combos from one
host (better-sqlite3 Node-API prebuilts make this trivial). Caveats:

- **Windows NSIS on a Linux host needs `wine`** (`sudo pacman -S wine` on
  CachyOS) for the installer step; the unpacked `.exe` trees are produced
  regardless.
- macOS targets build cross-platform on Linux, but codesign/notarization
  only run on macOS with your certs.
- Output lands in `release/<version>/` locally.
