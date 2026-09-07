# Chaptered internet fetch — IO contract (for rewrite)

IO-only reference for rewriting `pipeline2ChapteredInternet/internetFetch`.
No algorithm details, no names from the removed implementation. Everything
below is what the fetch observes from, and commits to, the world.

Entry point (the only export the scheduler imports):

```ts
fetchInternetChapter(
  novel: InternetNovel,        // from persisted entertainment config
  chapterNumber: number,
  options: {
    threadId: string;
    abortSignal?: AbortSignal;
    overrideUrl?: string;      // reader "chapter link" override — user-anchored
                               // chapter N: extract-only from this URL, no
                               // verification of chapter identity
  },
): Promise<"fetched" | "finalChapter" | "error">
```

## Callers (scheduler.ts) — what drives the fetch

| Caller | Trigger (REST) | Behavior around the fetch |
|---|---|---|
| `fetchLoop` | `POST /threads/:id/prefetch` (wizard "Fetch & Continue", fetch-only) and `POST /threads/:id/start` (wizard Start, fetch+rewrite), also `resumeOnOpen`, also `POST /threads/:id/current-url` (reader chapter-link override → `submitCurrentUrl` restarts the loop AT the cursor chapter with `overrideUrl`) | Serial loop from `opts.startAt ?? novel.startChapterNumber ?? 1`; per chapter: stop if `getFinalChapterNumber(threadId) != null`; skip if `getSourceChapter(threadId, n)?.status === "fetched"` (EXCEPT the override chapter — the user's URL is authoritative and always re-fetches); call fetch; on `"fetched"` optionally `rewriteChapter` (skips already-rewritten rows); on `"finalChapter"` or `"error"` break the loop. |
| `retryFailed` | `POST /threads/:id/retry` (UI "Redo failed") | For each chapter row with `sourceStatus === "error"`: re-fetch, then re-rewrite. |

Only one runner per thread (AbortController map in the scheduler). Thread
switch / Stop / wizard restart aborts the in-flight fetch via `abortSignal`.

## Inputs

- `novel: InternetNovel` — from `entertainmentFrontendService.getParsedConfig(threadId)`
  (persisted JSON config in `entertainment_configs`):
  `{ type: "internet", title: string, author?: string, sourceKind: "chapter" | "toc" | "page" | "search" | "content", source: string, startChapterNumber?: number }`.
  `sourceKind` says how the fetcher should treat `source`: the link kinds
  (`chapter` = direct link to chapter `startChapterNumber`, `toc` = the
  book's chapter-list page, `page` = any reading page of the book, `content`
  = non-chaptered direct content link, pipeline-3 only) all store a validated
  http(s) URL in `source`; `search` locates the book via title+author web
  search and leaves `source` unused (empty).

### DB reads (all via entertainment services)

| Read | Purpose |
|---|---|
| `getSourceChapter(threadId, n)` | Prior row status. `status === "error"` (retry) or absent ⇒ re-anchor via search. |
| `getSourceChapter(threadId, n - 1)` | Previous chapter's `url` (re-anchor after restart / mid-book start when `n === novel.startChapterNumber` and predecessor isn't `fetched`). |
| `entertainmentBackendService.getBlockedSites(threadId)` | Dead-site blocklist (see below). |

## Outputs

### DB writes — `source_chapters` row lifecycle

| Write (in order) | When |
|---|---|
| `markSourceChapterFetching({ threadId, chapterNumber })` | First thing, always. Upsert (insert fresh row or reset stale one) to `status: "fetching"`. |
| `updateSourceChapter(threadId, n, { url })` | On landing. URL is the redirect-resolved real page URL read from the live tab (`webContents.getURL()`), never a href string. |
| `updateSourceChapter(threadId, n, { content, title })` | On extraction. `content` = full prose (non-empty), `title` = chapter title or null. |
| `updateSourceChapter(threadId, n, { status: "fetched" })` | Orchestrator, after extraction succeeds. |
| `updateSourceChapter(threadId, n, { status: "error" })` | On failure — EXCEPT when `abortSignal.aborted` (keep `"fetching"` so the next runner re-fetches instead of scarring `error`). |
| `deleteSourceChapter(threadId, n)` | On `"finalChapter"` (removes the phantom chapter-N row). |

Every one of these emits `entertainment:chaptersChanged { threadId }` on the
eventBus — that is the UI's chapter-list/progress refresh signal.

### DB writes — `entertainment_configs`

| Write | When | Meaning |
|---|---|---|
| `blockSite(threadId, hostname, reason)` | A site is judged dead (wall, dead-end extraction, landing failure). | Appends to `blocked_sites` JSON column: `Record<hostname, reason>` (e.g. `{ "www.shuqi.com": "paywall" }`). **Persists across restarts and across chapters**; read back via `getBlockedSites` to avoid re-crawling dead sites. |
| `setSiteAnchors(threadId, { host, bookUrl, tocUrl })` | First site proven (via the toc-judgment agent) to host our book. | Persists the active crawl site into `site_anchors`; later chapters skip search and target the toc directly. |
| `clearSiteAnchors(threadId)` | Anchored site blocked / override URL points at a different host / book end. | Nulls the column. |
| `unblockSite(threadId, hostname)` | Reader chapter-link override names this host (the user vouches for it). | Removes the key from `blocked_sites` (null when empty). |
| `clearBlockedSites(threadId)` | Book end (crawl tab released). | Nulls the column. |
| `setFinalChapterNumber(threadId, n - 1)` | `"finalChapter"` outcome. | Drives the reader spine end + `fetchLoop` EOF check + `GET /chapters` response. |

### Return value semantics (consumed by scheduler)

- `"fetched"` — row is `fetched` with `url` + `content` + `title`; caller proceeds to rewrite.
- `"finalChapter"` — chapter N provably doesn't exist (N-1 was the last). Contract: has already done `setFinalChapterNumber(n-1)`, `deleteSourceChapter(n)`, released the crawl tab, cleared blocked sites.
- `"error"` — row marked `error` (unless aborted); `fetchLoop` stops; UI shows error; `retryFailed` can re-enqueue.

The function **never throws** for expected outcomes.

## Intermediate state (non-DB)

- **Crawl tab** — session id `ent-fetch-${threadId}`. One persistent
  `WebContentsView` tab via `SessionTabService` (`activateSession` then
  `getTabsForSession(sessionId)[0]`; point `sessionState.activeTabId` at it for
  split-view visibility). Expected to be carried chapter → chapter (a fetch may
  leave it where the current chapter ended and let the next chapter continue
  from there). Released at book end via `destroyAllTabs(sessionId)` — the same
  moment blocked sites are cleared.
- **Search tabs** — `executeSearchQueries` (browserWorker) creates/destroys
  its own tabs in a separate session (`ent-search-${threadId}`). Requires
  `activateSession(searchSessionId)` BEFORE (SessionTabService only tracks
  tabs of activated sessions, else 0 candidates) and re-`activateSession`
  the crawl session AFTER. Blocked hosts are filtered in the fetcher's own
  code after the call (its signature takes no blocked-host argument).
- **Per-fetch in-memory sets and budgets** — URLs already probed this fetch
  call (a site rotation never re-pays a candidate it already visited), and
  these hard budgets: **10 min** wall clock per chapter, **3 distinct
  hosts** per chapter, **2 landing retries** per site on a wrong chapter
  landing, and a **500-char minimum** on extracted prose (below it the
  site earns `dead-end:no-content` and rotation proceeds). A book-scoped
  RAM cache of search-result URLs (`searchEntry.ts`) avoids re-paying the
  LLM search analysis on rotation; it is cleared at book end
  (`clearSearchCache`, alongside blocked-sites/anchors clearing).
- **Site anchors** — the first site the toc-judgment agent confirms as our
  book is persisted as `{ host, bookUrl, tocUrl }` in
  `entertainment_configs.site_anchors`; subsequent chapters enter at the
  target stage (toc → chapter) without search. Blocking the anchored host
  clears the anchors with it.
- **Browser IO primitives used**: `TabControlService.navigateTo(tabId, url)`,
  `tab.webContents.getURL()` (post-redirect truth), `getFlattenDOMTool` /
  `clickElementTool` (DOM read / click, driven by `toolsContext` with
  `{ sessionId, activeTabId, threadId, chapterNumber, abortSignal }`),
  `sendCDPCommand(webContents, "Runtime.evaluate", …)` for cheap page probes.
  Shared wall-prompt text: `entertainmentWorker/shared/crawlWallPrompt.ts`
  (`buildUserInteractionWallBlock(action)`).

## Pipeline-3 (non-chaptered) note

Pipeline 3 (`pipeline3NonChapteredInternet`) does NOT search: it navigates
`novel.source` directly. The config validator forces `sourceKind: "content"`
with a valid http(s) URL whenever `nonNovelSource` is set, so a legacy
keyword-source config fails its pre-navigation guard with a re-configure
error (row marked `error`).

## Schema anchors (in `src/main/db/schema.ts`)

- `source_chapters`: `(threadId, chapterNumber)` unique; columns `url`,
  `title`, `content`, `status` (`fetching | fetched | error`).
- `entertainment_configs.blocked_sites`: JSON `Record<hostname, reason>`,
  nullable; `final_chapter_number`: nullable int.
- `entertainment_configs.site_anchors`: JSON `{ host, bookUrl, tocUrl }`,
  nullable (added by the `20260906114301_site_anchors` migration).
