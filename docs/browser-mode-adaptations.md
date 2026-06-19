# Browser / Web-Server Mode — Renderer Adaptations

> Status: **Plan / reference**. Tasks 1, 2, 3, 5 are implementation work; Task 4
> is a feasibility evaluation only (do **not** implement until reviewed).
>
> Authored as a standalone reference — it explains the architecture so it can be
> picked up in a fresh context.

## Context & Background

Autai runs the same React renderer in two environments:

1. **Native Electron window** — the main process loads the renderer with
   `?apiPort=<port>` appended to the load URL (`src/main/index.ts`, ~lines
   175–183). The renderer reads that param to build an absolute API base
   (`http://127.0.0.1:<port>`).
2. **Browser webpage (web-server mode)** — commit `ed9573d` made the Hono API
   server also serve the built renderer SPA (`apiServer.ts` → `serveSpa`).
   Browsers load it with **no** query param, so the renderer falls back to
   same-origin relative API URLs.

IPC was retired (commit `49844a2`); `src/preload/index.ts` is a no-op. The
renderer reaches the backend **exclusively over HTTP/SSE**.

### The seam: `?apiPort=`

| Environment | `?apiPort=` | API base |
| --- | --- | --- |
| Native Electron | present | `http://127.0.0.1:<port>` |
| Browser webpage | absent | `""` (same-origin relative) |

`new URLSearchParams(location.search).has("apiPort")` therefore detects native
mode. Today this read only lives implicitly inside `src/renderer/lib/api.ts`
(`initApiBase`). This plan makes it an explicit, reusable predicate and fixes the
features that assume a native Electron shell.

---

## Task 1 — Canonical detection helper

Add one predicate so every browser-vs-native branch reads the same signal.

**New file** `src/renderer/lib/env.ts`:

```ts
// Whether the renderer runs inside the native Electron shell. The main process
// appends ?apiPort=<port> to the load URL only in that mode; when the UI is
// served by the backend (remote browser), no param is present.
export function isNativeRenderer(): boolean {
  return new URLSearchParams(window.location.search).has("apiPort");
}
```

- Uses `.has()` (not `.get()`) — matches the intended detection and is robust
  against an empty `?apiPort=`.
- Sits beside `src/renderer/lib/api.ts` (which keeps its own `.get()` read for
  the base URL). No caching needed; one cheap URL parse.

---

## Task 2 — Attachment picker: native dialog vs browser file input

`ComposerAddAttachment.handleClick` in `src/renderer/components/ai-chat/attachment.tsx`
(lines 311–329) always POSTs `/dialog/open-files`, which calls Electron's
`dialog.showOpenDialog` (`src/main/agents/routes/dialogRoutes.ts`). In browser
mode that route returns `[]` (no focused window) → the button does nothing.

### Design — single `pickFiles()` abstraction

**New file** `src/renderer/lib/filePicker.ts`:

```ts
import { isNativeRenderer } from "@/lib/env";
import { httpClient } from "@/lib/httpClient";

function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// --- Browser path: hidden <input type="file" multiple> ---
let fileInputEl: HTMLInputElement | null = null;
function getHiddenFileInput(): HTMLInputElement {
  if (fileInputEl) return fileInputEl;
  const el = document.createElement("input");
  el.type = "file";
  el.multiple = true;
  el.accept = "*";
  // Offscreen rather than display:none — some browsers refuse to open the
  // picker on a display:none element.
  el.style.cssText = "position:fixed;top:-9999px;left:-9999px;opacity:0;";
  document.body.appendChild(el);
  fileInputEl = el;
  return el;
}

function pickFilesViaBrowser(): Promise<File[]> {
  return new Promise((resolve) => {
    const el = getHiddenFileInput();
    el.value = ""; // allow re-selecting the same file
    const cleanup = () => {
      el.removeEventListener("change", onChange);
      window.removeEventListener("focus", onFocus);
    };
    const onChange = () => {
      cleanup();
      resolve(el.files ? Array.from(el.files) : []);
    };
    // Browsers don't fire `change` on cancel; use the focus + timeout heuristic.
    let cancelTimer = 0;
    const onFocus = () => {
      window.clearTimeout(cancelTimer);
      cancelTimer = window.setTimeout(() => {
        if (!el.files || el.files.length === 0) {
          cleanup();
          resolve([]);
        }
      }, 500);
    };
    el.addEventListener("change", onChange);
    window.addEventListener("focus", onFocus);
    el.click();
  });
}

// --- Native path: existing Electron dialog over HTTP ---
async function pickFilesViaDialog(): Promise<
  { file: File; fsPath: string; name: string }[]
> {
  const results = await httpClient.postJSON<
    Array<{ path: string; name: string; data: string; mimeType: string }>
  >("/dialog/open-files");
  if (!Array.isArray(results)) return [];
  return results.map(({ path: fsPath, name, data, mimeType }) => ({
    file: new File([base64ToUint8Array(data) as BlobPart], name, {
      type: mimeType,
    }),
    fsPath,
    name,
  }));
}

// Unified entry point.
export async function pickFiles(): Promise<
  { file: File; fsPath?: string; name: string }[]
> {
  if (isNativeRenderer()) {
    return pickFilesViaDialog();
  }
  const files = await pickFilesViaBrowser();
  return files.map((file) => ({ file, name: file.name }));
}
```

### Simplified handler in `attachment.tsx`

```tsx
import { pickFiles } from "@/lib/filePicker";

const handleClick = async () => {
  const picked = await pickFiles();
  for (const { file, fsPath, name } of picked) {
    if (fsPath) filePathStore.set(name, fsPath); // native only
    await aui.composer().addAttachment(file);
  }
};
```

### Notes

- `base64ToUint8Array` and `pickFilesViaDialog` move into `filePicker.ts`
  (only the native path needs base64). `filePathStore` stays in `attachment.tsx`
  with its only consumer (`DocumentAttachmentCard.handleReveal`, lines 170–173).
- Browser `File` objects have no filesystem path → `filePathStore` is never set
  → the "reveal in folder" card already self-disables (its `role`/`onClick` are
  gated on `filePath` at `attachment.tsx` lines 178–183). No UI change needed.
- The downstream adapter `src/renderer/adapters/universalFileAttachmentAdapter.ts`
  consumes `File` objects unchanged — works in both modes with no edits.
- `src/renderer/components/ai-chat/composer-action.tsx` just renders
  `<ComposerAddAttachment />` — no change.
- Hidden input lives at module scope (not component state) so it survives React
  unmounts and StrictMode double-invokes (`main.tsx` uses `<React.StrictMode>`).

---

## Task 3 — Hide the SplitView toggle **in the browser webpage only**

> Confirmed intent: the toggle stays in native Electron rendering and is hidden
> only when served to a browser. SplitView renders an Electron-native
> `WebContentsView` (`src/main/services/SessionTabService.ts`) which cannot exist
> inside a plain browser DOM.

### Changes

1. **Hide the toggle** in `src/renderer/components/app-header.tsx` — wrap the
   existing `Toggle`/`Tooltip` block (lines 93–109) in
   `{isNativeRenderer() && (…)}`, importing `isNativeRenderer` from `@/lib/env`.

2. **Guard the SSE-driven activation** in `src/renderer/main.tsx` (lines 296–298).
   `showSplitView` is **not** persisted (defaults `false`, `src/renderer/stores/uiStore.ts`
   lines 108–111), but the `splitview:activate` server event can still flip it on
   in browser mode — it is emitted by `POST /shell/open-external`
   (`src/main/agents/routes/shellRoutes.ts` line 24) which runs server-side
   regardless of client type (see Task 5). Without this guard the hidden toggle
   would not stop an empty `ResizablePanelGroup` from rendering and POSTing
   spurious `/sessions/container-rect` bounds (`main.tsx` lines 130–163):

   ```ts
   serverEvents.on("splitview:activate", () => {
     if (!isNativeRenderer()) return; // impossible in a browser webpage
     useUiStore.getState().setShowSplitView(true);
   });
   ```

---

## Task 4 — Screenshot of SplitView page → browser UI (EVALUATION ONLY)

> Do **not** implement. Captured here for impact/complexity assessment.

### Reachability

`SessionTabService` keeps `WebContentsView` instances in
`tabs: Map<TabId, WebContentsView>` with `getTab(tabId)`. A view's
`webContents.capturePage(rect?)` → `NativeImage` (`toJPEG(q)` / `toPNG()` /
`toDataURL()`). **No `capturePage` usage exists anywhere today.**

### Gating risk (the real blocker, not the transport)

`updateTabVisibility` (~lines 369–414) only paints a tab when
`frontendVisibility === true`, which is set solely by `setContainerRect(non-null)`
(~lines 422–456) — only sent from the renderer when `showSplitView` is true.
After Task 3's guard, `showSplitView` can never go true in browser mode → the
view is never made visible → `capturePage` likely returns **blank/black**.

Any option requires first forcing the active tab to paint:

- **Force-paint** — keep the active tab `setVisible(true)` + bounded on the
  native window in web-server mode even when `frontendVisibility` is false, so it
  has real pixels. Risk: native window flashing if not truly hidden; minimized
  windows on Windows may stop compositing.
- **Offscreen rendering** — create tabs with `webPreferences: { offscreen: true }`
  and read `webContents.on("paint", ...)`. Far more invasive; DOMService/debugger
  behavior on offscreen renderers is uncertain.

**Verify with a spike before committing to a transport.**

### Transports available

- **REST** — Hono app; `cors()` already global, so binary cross-origin fetch is
  fine.
- **SSE** — existing `/events` (`src/main/agents/routes/eventsRoutes.ts`),
  text-only → must base64. Adding an event needs an entry in `src/shared/events.ts`
  (`ServerEvents` + `SERVER_EVENT_NAMES`) and an `eventBus.onEvent` subscriber in
  `eventsRoutes.ts`.
- **WebSocket** — **not present.** `@hono/node-server` has no native WS upgrade;
  adding `ws` + manual upgrade is medium-high cost and unnecessary given SSE.

### Options

| Option | Approach | FPS realistic | Complexity |
| --- | --- | --- | --- |
| A | On-demand REST `GET /sessions/:id/screenshot?tabId=` → `image/jpeg` in `<img>` | snapshot | **Low** (~40 LOC, 0 deps) |
| B | MJPEG `multipart/x-mixed-replace` over HTTP, `<img src>` | 1–5 | Medium (~55 LOC) |
| C | WebSocket binary frames | 5–15 | High (new `ws` dep + upgrade plumbing) |
| D | Base64 frames over existing SSE bus (`sessions:screenshot`) | 1–3 | Medium (~35 LOC) |
| E | Capture-on-event (after nav/action), push one frame via SSE/poll | event-driven | Low–Medium |

### Cross-cutting concerns

- `capturePage + toJPEG` is main-process work (~30–80 ms per 1080p frame) that
  competes with the agent loop — cap ~3 fps live or capture downscaled bounds.
- Multi-client dedup needs a single timer fanning to subscribers (A dedups
  poorly; B/D naturally dedup).
- JPEG ≪ PNG for size. SSE (D) requires base64 (~33% inflation).
- Active-tab discovery already exists: `POST /sessions/active-tab`
  (`src/main/agents/routes/sessionRoutes.ts` lines 64–78). There is no
  "active tab changed" event yet — add `eventBus.emitEvent` in
  `navigateActiveTabToUrl` if needed.
- Capture loops/streams must tear down on tab close (`destroyTab` already emits
  `threadview:destroyed` — nothing subscribes today).

### Recommendation

- **MVP** = Option A (Low). "Show me what the AI sees right now" button.
- **Good live view** = Option D (Medium), reusing the connected SSE stream.
- **Resolve the paint/visibility blocker first** — without it every option
  returns blank frames.
- **Avoid** Option C (WS plumbing cost outweighs the benefit).

---

## Task 5 — URL click handling in browser mode (open in a new tab)

### Why this is needed (and where it's already fine)

The "default click → splitview" behavior is implemented entirely in the
**main process** (`src/main/index.ts` lines ~130–173: `will-navigate` +
`setWindowOpenHandler` on the native window's `webContents`). Those handlers
**never fire in browser mode**, so anything that flows through a real anchor or
`window.open` already behaves like a normal web page:

| URL source | Browser mode today |
| --- | --- |
| `<a target="_blank">` (Sources badges, sidebar links) | ✅ new tab |
| Direct `window.open(...)` (`provider-catalog.tsx`, `development-section.tsx`) | ✅ new tab |
| Citations → `openSafeNavigationHref` → `window.open` (`citation.tsx`, `citation-list.tsx`) | ✅ new tab |

Only code that **bypasses the anchor and calls `/shell/*` directly** misbehaves in
browser mode. Fix each below.

### 5a. Markdown links — skip the link-safety modal in browser mode

In `src/renderer/components/ai-chat/streamdown.tsx` (lines 51–54), gate
`linkSafety.enabled` on `isNativeRenderer()`:

```tsx
linkSafety={{
  enabled: isNativeRenderer(),
  renderModal: (props) => <LinkSafetyModal {...props} />,
}}
```

**Verified:** with the modal off, Streamdown's default link component renders
`<a href target="_blank" rel="noreferrer">` (confirmed in
`node_modules/streamdown/dist/chunk-BO2N2NFS.js`:
`data-streamdown:"link",href:o,rel:"noreferrer",target:"_blank"`). So markdown
links open a new tab automatically — **no custom link component needed**. The
`LinkSafetyModal` buttons (which call `/shell/*`) are only ever mounted in
native mode now, so they need no change.

### 5b. Centralized open helper for the remaining explicit `/shell/*` callers

Add two branch functions to the existing
`src/renderer/components/tool-ui/shared/media/safe-navigation.ts` (already the
home of `openSafeNavigationHref`):

```ts
import { isNativeRenderer } from "@/lib/env";
import { httpClient } from "@/lib/httpClient";

// Open a URL in the app SplitView (native) or a new browser tab (web).
export function openUrl(url: string): void {
  if (isNativeRenderer()) {
    void httpClient.postCommand("/shell/open-external", { url });
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

// Open a URL in the external/system browser (native) or a new tab (web).
export function openUrlExternal(url: string): void {
  if (isNativeRenderer()) {
    void httpClient.postCommand("/shell/open-system-browser", { url });
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
```

Leave `openSafeNavigationHref` as-is — citations already work in both modes via
`window.open` (native: caught by `setWindowOpenHandler` → splitview; browser:
new tab).

### 5c. Rewire the explicit callers

- `src/renderer/components/tools/genericToolkit.tsx` (source context menu,
  lines ~139–158):
  - Hide the **"Open in Autai"** item in browser mode
    (`{isNativeRenderer() && (...)}` — no splitview to open into).
  - Route **"Open in External Browser"** through `openUrlExternal(s.url)` so it
    opens a new tab instead of `shell.openExternal` on the host (wrong machine in
    remote mode).
  - The badge's own left-click (`<a target="_blank">`) is already fine.
- `src/renderer/components/settings/settings-sections/about-section.tsx`
  (line 62, `openExternal`): route through `openUrl(url)`.

The `/shell/open-external` and `/shell/open-system-browser` routes themselves
stay unchanged (still correct for native mode); the branch is renderer-side. Any
server-side `splitview:activate` emission that still slips through is neutralized
by the Task 3 guard.

### Call-site inventory (for completeness)

| File | Line | Current call | Browser-mode fix |
| --- | --- | --- | --- |
| `link-safety-modal.tsx` | 34 | `/shell/open-system-browser` | none — modal skipped via 5a |
| `link-safety-modal.tsx` | 39 | `/shell/open-external` | none — modal skipped via 5a |
| `genericToolkit.tsx` | 141 | `/shell/open-external` | hide item in browser mode |
| `genericToolkit.tsx` | 151 | `/shell/open-system-browser` | `openUrlExternal` |
| `about-section.tsx` | 62 | `/shell/open-external` | `openUrl` |
| `citation.tsx` | 118 | `openSafeNavigationHref` | none — already works |
| `citation-list.tsx` | 204, 360 | `openSafeNavigationHref` | none — already works |

---

## Verification

> Per `CLAUDE.md`: do **not** run `pnpm` yourself — ask the user to run these.

1. `pnpm tsc` — type-check both processes (new `lib/env.ts`, `lib/filePicker.ts`;
   edited `attachment.tsx`, `app-header.tsx`, `main.tsx`, `streamdown.tsx`,
   `genericToolkit.tsx`, `about-section.tsx`, `safe-navigation.ts`).
2. `pnpm lint` and `pnpm format`.
3. **Native Electron (`pnpm dev`):**
   - Attachment "+" opens the **native** file dialog; multi-select works;
     "reveal in folder" works on document cards.
   - SplitView toggle is **visible**; clicking it shows the `WebContentsView`.
   - Markdown link → safety modal → "Open in Autai" opens SplitView; source
     context menu shows both items.
4. **Browser webpage (remote mode):** open the served URL in a real browser:
   - Attachment "+" opens the **browser's** file picker; files attach and send;
     "reveal in folder" is correctly absent/disabled.
   - SplitView toggle is **hidden**; the empty panel + stray `container-rect`
     POSTs do not occur.
   - Markdown links open a **new browser tab** directly (no safety modal).
   - Sources badge left-click opens a new tab; its context menu shows no
     "Open in Autai", and "Open in External Browser" opens a new tab (not the
     host machine). About-page links open a new tab.
5. Confirm `?apiPort=` is present in the native window's URL and absent when
   served to the browser (DevTools → `location.search`).

(Task 4 is evaluation-only — no code, no verification.)

---

## Out of scope / follow-ups

- **Task 4 screenshot feature** — pending the paint/visibility spike and a
  transport decision (see above).
- **Reveal-in-folder in browser mode** — already self-disables; no action.
- **`showSplitView` persistence** — none today; if ever added, clamp the initial
  state in `uiStore` with `isNativeRenderer()`.
- **AI-driven browser-use visibility in browser mode** — the AI still runs
  server-side; a remote user cannot see it without Task 4.
