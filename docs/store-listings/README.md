# Store Listings

Ready-to-paste listing copy for the two stores this repo ships to (build/signing
pipeline: see [`../store-signing.md`](../store-signing.md)):

| File | Store | Language |
|---|---|---|
| [`mac-app-store.en-US.md`](mac-app-store.en-US.md) | Mac App Store (App Store Connect) | English (en-US) |
| [`mac-app-store.zh-Hans.md`](mac-app-store.zh-Hans.md) | Mac App Store | 简体中文 (zh-Hans) |
| [`microsoft-store.en-US.md`](microsoft-store.en-US.md) | Microsoft Store (Partner Center, MSIX) | English (en-US) |
| [`microsoft-store.zh-Hans.md`](microsoft-store.zh-Hans.md) | Microsoft Store | 简体中文 (zh-Hans) |

Declare **English + Chinese (Simplified)** listings on both stores — this matches
`appx.languages` (`en-US`, `zh-Hans`) in `electron-builder.json`. The Chinese
copy is written natively (not translated from the English) and the two versions
evolve independently — a wording change in one language is not a reason to
change the other.

Copy blocks are fenced so they can be pasted verbatim. The `→ N characters`
line under each fence is the exact count for the text above it — recount after
any edit (`wc -m` for characters, `wc -c` for bytes; the keywords field is
byte-limited).

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
  subtitle, keywords, description, promotional text, and What's New.
- **Partner Center**: the Autai product → Store listings → pick the language →
  Description field, Release notes, and Search terms under supplemental fields.

## Assets and links

- Screenshots: reuse `docs/screenshots/`; both stores additionally need
  platform-sized captures of the actual app.
- Microsoft Store logos live in `build/appx/` (see `../store-signing.md`).
- Privacy policy URL: link the repo-hosted [`../../PRIVACY.md`](../../PRIVACY.md).
- Support URL: https://github.com/upwindchange/Autai/issues
- Marketing URL (App Store): https://github.com/upwindchange/Autai
- Category (Mac App Store): Productivity (`public.app-category.productivity`,
  already set in `electron-builder.json`).
