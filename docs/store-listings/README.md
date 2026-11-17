# Store Listings

Ready-to-paste listing copy for the two stores this repo ships to (build/signing
pipeline: see [`../store-signing.md`](../store-signing.md)):

| File | Contents | Language |
|---|---|---|
| [`shared-description.md`](shared-description.md) | Long description + release notes — shared verbatim by **both** stores | en-US and zh-Hans |
| [`mac-app-store.en-US.md`](mac-app-store.en-US.md) | Mac App Store name, subtitle, promotional text, keywords | English (en-US) |
| [`mac-app-store.zh-Hans.md`](mac-app-store.zh-Hans.md) | Mac App Store name, subtitle, promotional text, keywords | 简体中文 (zh-Hans) |
| [`microsoft-store.en-US.md`](microsoft-store.en-US.md) | Microsoft Store short description, search terms | English (en-US) |
| [`microsoft-store.zh-Hans.md`](microsoft-store.zh-Hans.md) | Microsoft Store short description, search terms | 简体中文 (zh-Hans) |

The long Description and the release-notes copy are pasted into both stores, so
they exist in exactly one place: `shared-description.md`. Per-store files hold
only fields unique to that store and point at the shared blocks — never copy a
shared block into a per-store file.

The selling order, everywhere: **1) free web research** (quick / standard / deep,
with Deep Research writing full cited reports; searching runs our own browser
against Google/Bing — no search-API fees), **2) Story Mode**. Self-hosting — run
it on your own machine, use it from any device's browser with the mobile
layout, optional password sign-in — is a concrete third differentiator; the
zh-Hans copy gives it a section of its own. Providers/models, browser
automation, thread organization, and rich answers are valid but secondary —
keep them below the majors.

Declare **English + Chinese (Simplified)** listings on both stores — this matches
`appx.languages` (`en-US`, `zh-Hans`) in `electron-builder.json`. The zh-Hans
copy is a separate piece of writing aimed at Chinese internet users (web-fiction
readers, the Bilibili generation) in their own voice — not a translation of the
en-US copy. The two versions evolve independently — a wording change in one
language is not a reason to change the other.

Copy blocks are fenced so they can be pasted verbatim. The `→ N characters`
line under each fence is the exact count for the text above it — recount after
any edit (`wc -m` for characters, `wc -c` for bytes; the keywords field is
byte-limited).

Provider/model figures ("225+ providers, 8,000+ models") are recounted from
`resources/providers/` (225 `provider.toml`, 8,399 `models/*.toml` as of
2026-11-17; the copy rounds down with a `+` so it stays true as the catalog
grows). Recount with:

```bash
find resources/providers -name 'provider.toml' | wc -l
find resources/providers -path '*/models/*.toml' | wc -l
```

## Field limits

Mac App Store (App Store Connect):

| Field | Limit | Note |
|---|---|---|
| Name | 30 characters | searchable, strongest ranking weight |
| Subtitle | 30 characters | searchable |
| Promotional text | 170 characters | editable without a new submission |
| Keywords | 100 bytes | comma-separated; words already in name/subtitle don't need repeating |
| Description | 4,000 characters | not indexed for App Store search |
| What's New | 4,000 characters | per version |

Microsoft Store (Partner Center, MSIX listing):

| Field | Limit | Note |
|---|---|---|
| Short description | 1,000 characters | only the first 270 show in some views — front-load the pitch |
| Description | 10,000 characters | plain text |
| Release notes | 1,500 characters | |
| Search terms | 7 unique terms/phrases | separate with semicolons |

## Where to paste

- **App Store Connect**: the app → version → App Store tab holds name,
  subtitle, keywords, description, promotional text, and What's New. Description
  and What's New come from `shared-description.md`.
- **Partner Center**: the Autai product → Store listings → pick the language →
  Description field, Release notes, and Search terms under supplemental fields.
  Description and Release notes come from `shared-description.md`.

## Assets and links

- Screenshots: reuse `docs/screenshots/`; both stores additionally need
  platform-sized captures of the actual app.
- Microsoft Store logos live in `build/appx/` (see `../store-signing.md`).
- Privacy policy URL: link the repo-hosted [`../../PRIVACY.md`](../../PRIVACY.md).
- Support URL: https://github.com/upwindchange/Autai/issues
- Marketing URL (App Store): https://github.com/upwindchange/Autai
- Category (Mac App Store): Productivity (`public.app-category.productivity`,
  already set in `electron-builder.json`).
