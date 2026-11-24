# CLI Reference

## App launch flags

Defined in `src/main/cli.ts`. All flags are per-run and never persisted — saved
settings apply again on the next flag-free start. Both `--flag value` and
`--flag=value` forms parse; invalid values are warned (electron-log, `Cli`
scope) and ignored. Flags and their values are stripped from `app.relaunch()`'s
argv so relaunched runs are flag-free.

| Flag | Meaning |
|---|---|
| `--remote` | Boot in Remote Access mode for this run, regardless of the saved connection setting. Settings stay editable; `resetToLocalMode` strips the flag on relaunch. |
| `--host <addr>` | Remote Access bind address for this run (saved default: `0.0.0.0`). Inert without `--remote`. |
| `--port <n>` | Remote Access port for this run, 1–65535 (saved default: `8787`). Inert without `--remote`. |
| `--window-size <WxH>` | Pin the main window's client size, e.g. `--window-size=1440x900`. Screenshot capture aid. |
| `--frameless` | Hide OS window chrome (title bar, traffic lights). Screenshot capture aid. |

### Development

electron-vite forwards everything after `--` to the Electron process
(`process.argv`):

```powershell
pnpm dev -- --remote --host 0.0.0.0 --port 9000
pnpm dev -- --window-size=1440x900 --frameless
```

### Packaged app

```powershell
Autai --remote --port 9000
Autai --window-size=1440x900 --frameless
```

## Store screenshot capture

`scripts/store-screenshot.mjs` — interactive CDP capture. Captures the renderer
surface (never the OS window), so output is exactly `<W*scale> × <H*scale>`
pixels: no title bar, borders, or DWM shadow. Two terminals:

```powershell
# terminal 1: app with CDP endpoint
pnpm dev -- --remote-debugging-port=9333 --window-size=1440x900 --frameless
```

```powershell
# terminal 2: capture loop
node scripts/store-screenshot.mjs --port 9333 --size 1440x900 --scale 2 --out docs/screenshots/store
```

Arrange each screen in the app, type a filename in terminal 2 (empty input
quits). Only the main renderer surface is captured — split-view browser tabs
(WebContentsView) are out of scope.

| Output size | `--size` / `--scale` |
|---|---|
| 2880×1800 | `--size 1440x900 --scale 2` |
| 2560×1600 | `--size 1280x800 --scale 2` |
| 1440×900 | `--size 1440x900 --scale 1` |

Flags: `--port` (default 9333), `--size WxH` (default 1440x900), `--scale`
(default 2), `--out` (default `docs/screenshots/store`).

## pnpm scripts with arguments

| Command | Arguments |
|---|---|
| `pnpm db:generate --name <version>` | `--name` required: the intended next release version, `X.Y.Z[-rc.N]` (timestamp folder prefix is added by drizzle-kit). |
| `pnpm db:generate:custom --name <version>[_tag]` | `--name` required; underscore suffix names the manual migration (e.g. `1.0.1_fts5`). |

Other scripts (`dev`, `preview`, `start`, `build*`, `lint`, `format`, `tsc`)
take no arguments; see CLAUDE.md "Key Commands".
