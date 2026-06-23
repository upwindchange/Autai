# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Autai is a desktop application built with Electron, React, and TypeScript. Its core capability is AI-driven **research** — quick, normal, and deep web research that synthesizes cited answers — plus an **entertainment mode** that transforms web novels into cleaner or interactive reading. **Browser-use** (direct AI control of a real browser) is a bonus alpha feature that also serves as the foundation underpinning the research and entertainment agents. The app is in active alpha development.

## Key Commands

**IMPORTANT**:

1. Do not run any pnpm command except for `pnpm tsc`, ask the user to run it.
2. This project does not use npm, npx. It uses pnpm and pnpm dlx.
3. All files uses 2 whitespaces to indent, not tab.
4. All files, except for windows .bat and .cmd files, use LF as end of line, not CRLF.
5. In your plan, design, and implementation workflow, do not include any verification step other than running `pnpm tsc`. You are not allowed to write tests or run any kind of tests.

```bash
# Development
pnpm dev          # electron-vite build && electron-vite dev
pnpm preview      # electron-vite preview
pnpm start        # electron-vite preview --skipBuild

# Build
pnpm build        # electron-vite build + electron-builder (current platform)
pnpm build:vite   # electron-vite build only (no packaging)
pnpm build:win    # build Windows installer (NSIS)
pnpm build:linux  # build Linux AppImage
pnpm build:mac    # build macOS zip
pnpm build:all    # build all platforms via scripts/build-all-platforms.js

# Quality
pnpm tsc          # Type-check both main and renderer (tsc:node && tsc:web)
pnpm lint         # eslint .
pnpm format       # prettier --write src/

# Database
pnpm db:generate        # Generate drizzle migrations from schema changes
pnpm db:generate:custom # Generate a custom (empty) drizzle migration
```

## Architecture

### Multi-Process Design

- **Main Process** (`src/main/`): Electron main process — manages windows, native APIs, core services, and the AI agent system. Hosts the Hono REST + SSE API server.
- **Renderer Process** (`src/renderer/`): React 19 app — UI layer with TypeScript, Tailwind CSS v4, and @assistant-ui/react. A pure HTTP/SSE client of the main process.
- **Preload** (`src/preload/`): **Intentionally a no-op.** The renderer reaches the backend exclusively over HTTP/SSE, and the API port is passed via the load URL (`?apiPort=`). With no IPC surface, there is nothing for `contextBridge` to inject. (`sandbox` is currently `false`, with a tracked follow-up to flip it to `true`.)
- **Shared** (`src/shared/`): Type definitions shared between main and renderer — `settings`, `providers`, `session`, `tools`, `logger`, `tag`, `mcp`, `auth`, `events`, `entertainment`, plus the `dom/` subpackage.

### Communication: REST + SSE

There is **no Electron IPC**. All renderer↔main traffic is HTTP REST plus Server-Sent Events, served by a Hono server in `src/main/agents/apiServer.ts`.

- **Run modes** (`settings.serverMode`):
  - **Standalone** (default): binds `127.0.0.1` on a random OS-assigned port; the renderer receives the port via `?apiPort=` in its load URL. Local only.
  - **Remote Access**: binds a configurable host/port (default `0.0.0.0:8787`) and also serves the built renderer SPA, so network browsers can use the app. An auth middleware activates **only in remote mode when a password is set** (session cookie / bearer token; loopback owner exempt; public SPA/health/login paths exempt).
- **REST routes** mounted in `apiServer.setupRoutes()`: `/chat`, `/entertainment`, `/threads`, `/tags`, `/settings`, `/providers`, `/mcp`, `/events`, `/app`, `/shell`, `/dialog`, `/sessions`, `/hitl`, `/auth`, plus `/health`.
- **SSE** (`GET /events`, `eventsRoutes.ts`): forwards `eventBus` emissions to connected clients as named events with monotonic IDs, sends a 25s heartbeat to avoid idle timeouts, and resumes from `Last-Event-ID`. Event names: `threads:metadataUpdated`, `threads:suggestionsUpdated`, `app:message`, `splitview:activate`, `threads:listChanged`.

### Main Process

The main process initializes in `src/main/index.ts` with this startup sequence: app ready → splash screen → electron-log init + error catch → database init (Drizzle migrations) → services init (`searchService`, `threadPersistenceService`, `settingsService`, `authService`, i18n) → provider registry init (reads the TOML catalog from `resources/providers/`) → thread intelligence init → log-level config → telemetry (Langfuse) init → API server start → main window (created with the API port passed via `?apiPort=`). `SessionTabService`, `TabControlService`, and `PQueueManager` are initialized inside `createWindow` before the renderer loads.

**Agent System** (`src/main/agents/`):

- `apiServer.ts` — Hono REST + SSE server (see above)
- `routes/` — 14 REST route files (chat, entertainment, threads, tags, settings, providers, mcp, events, app, shell, dialog, sessions, hitl, auth)
- `providers/` — AI provider factory (`provider.ts`) and registry (`registry.ts`); the provider/model catalog is loaded from TOML files in `resources/providers/`, layered with per-user credentials and overrides stored in SQLite
- `schemas/` — Zod schemas for API request/response validation
- `tools/` — Agent tools exported as `allBrowserTools`: `interactiveTools` (click/fill/hover/drag/scroll/getAttribute/evaluate/getBasicInfo), `domTools` (`getDOMTree`/`getFlattenDOM`), `sessionTools`, `navigationTools` (navigate/refresh/goBack/goForward), `hitlTools` (`requestHumanIntervention`/`requestUserInput`/`requestOptionList`/`requestQuestionFlow`), `askUserTool`, `sourceTools`, `calculateTool`
- `workers/` — Agent workers, organized as a router tree:
  - `chatWorker.ts` — plain chat completions, merges MCP tools, streams via `createUIMessageStreamResponse`
  - `browserWorker/worker.ts` — **router**: `deepResearch` → deep-research worker; `useBrowser` → browser-use worker; `webSearch`/`quickSearch` → browser-research worker
  - `browserWorker/browser-use/` — **bonus alpha** browser automation: planner → HITL approval → action-executor → replanner → summary (planned mode), or simple direct execution
  - `browserWorker/browser-research/` — normal + quick research: setup → researchPlanner (queries) → executeSearchQueries (per-query tabs) → extractResultsFromUrls (skipped in quick mode) → summarizeFindings / summarizeFindingsFromSnippets → references
  - `browserWorker/deep-research/` — deep research: pre-research → optional HITL clarification (`askUser`) → deepResearchPlanner (subtopics) → per-subtopic loop (plan → search → extract → summarize) → citation remap → composition → references
  - `entertainmentWorker/worker.ts` — **router** on `config.mode`: `dehydrate` | `interactive`. Both sub-agents are currently **placeholders** that stream sample CJK content to validate the entertainment UI; the intended behavior is novel "dehydration" (stripping filler for cleaner reading) and interactive-fiction transformation.

**Services** (`src/main/services/`):

- `SessionTabService` — manages browser tabs/sessions for the split view, integrates with `DOMService` (under `services/dom/`) and element interaction (under `services/interaction/`)
- `TabControlService` — tab navigation and view management
- `settingsService` — settings persistence (providers, model assignments, server mode, etc.)
- `threadPersistenceService` — thread/message persistence to SQLite
- `threadIntelligenceService` — automatic thread tagging, title generation, suggestions
- `searchService` — web/thread search
- `HitlService` — human-in-the-loop pause/resume and request/response
- `mcpService` — MCP server configuration, connection, and tool discovery
- `authService` — remote-access password authentication and session management

**Database** (`src/main/db/`):

- SQLite via better-sqlite3 with Drizzle ORM (1.0.0-beta.22)
- Schema in `schema.ts` (9 tables): `settings` (key-value), `userProviders`, `modelAssignments` (per-role model selection), `threads` (includes `mode` = `chat`|`entertainment`, plus per-thread `chatProviderId`/`chatModelId`/`chatModelParams`/`chatSystemPrompt` overrides), `messages`, `tags`, `mcpServers`, `threadTags` (many-to-many), `authSessions`
- Migrations generated to `drizzle/` via `pnpm db:generate`, copied to `out/main/drizzle/` at build time
- Custom Vite plugins in `electron.vite.config.ts` handle native binding copy (`bindingSqlite3`), migration copy (`copyMigrations`), and dev main-process reload (`watch-main-reload`)

### App Modes

- **Top-level `appMode`** (`chat` | `entertainment`), toggled in `components/side-bar/nav-secondary.tsx`. Threads are partitioned by `threads.mode`, and the thread list is scoped to the active app mode.
- **Research sub-modes** (within `chat`, mutually exclusive, held in `uiStore`): `webSearch` (normal research), `quickSearch` (quick research — skips content extraction, summarizes from snippets), `deepResearch` (deep research), and `useBrowser` / `usePlannedBrowser` (bonus alpha browser automation). Each sub-mode maps to a worker under `browserWorker/` (see Agent System).
- **Entertainment sub-modes**: `dehydrate` | `interactive`, served by `entertainmentWorker/` (currently placeholders).

### Renderer Process

Built on @assistant-ui/react with custom components. The renderer is a pure HTTP/SSE client — no IPC.

**State Management** (`src/renderer/stores/`):

- `uiStore` — settings visibility; the mutually-exclusive research/browser mode flags; `appMode` and `lastActiveByMode`; split-view state; active `sessionId`; enabled MCP server ids
- `tagStore` — tags, thread-to-tag mapping, thread metadata, search, multi-select
- `threadModelStore` — per-thread chat-model override cache; loads `GET /threads/:id/model` and sends `X-Chat-Provider-Id` / `X-Chat-Model-Id` headers

**API layer** (`src/renderer/lib/`): `httpClient.ts` (postJSON/postStream/postCommand/delete/getJSON; emits `AUTH_UNAUTHORIZED_EVENT` on 401), `api.ts` (resolves the API base from `?apiPort=` or same-origin), `serverEvents.ts` (EventSource manager for `/events` with `on()`/`onReconnect()`).

**Adapters**: `adapters/backendThreadListAdapter.tsx` — REST thread CRUD scoped by `appMode`, plus `BackendThreadHistoryAdapter` for message history. `AssistantChatTransport` in `main.tsx` attaches custom headers (`X-Use-Browser`, `X-Web-Search`, `X-Deep-Research`, `X-Quick-Search`, `X-Session-Id`, `X-Mcp-Servers`, `X-Chat-Provider-Id`, `X-Chat-Model-Id`) and routes requests to `/chat` or `/entertainment` based on `appMode`.

**Key Component Areas** (`src/renderer/components/`):

- `ai-chat/` — main chat UI: thread, markdown streaming, attachments, running indicator
- `assistant-ui/` — vendored from @assistant-ui/react (do not modify directly; copy out if changes needed)
- `auth/` — `LoginScreen` for remote-access mode
- `entertainment/` — entertainment-mode UI: `EntertainmentWizard` (with `steps/`), `entertainment-thread`, `NovelText`, `ProgressBar`
- `tool-ui/` — tool-specific UI cards: approval-card, citation, input-card, option-list, parameter-slider, plan, question-flow
- `tools/` — frontend toolkits (generic, hitl)
- `settings/` — provider/model configuration, MCP servers, connection, AI agents, and other sections under `settings-sections/`
- `side-bar/` — thread list, tag management, app-mode toggle
- `icons/` — icon components
- `ui/` — shadcn/ui base components (Tailwind-based)

### TypeScript Path Aliases

| Alias                  | Points To          | Used In          |
| ---------------------- | ------------------ | ---------------- |
| `@/`, `@/*`            | `src/main/`        | Main process     |
| `@agents`, `@agents/*` | `src/main/agents/` | Main process     |
| `@/`, `@/*`            | `src/renderer/`    | Renderer process |
| `@shared`, `@shared/*` | `src/shared/`      | Both processes   |

Note: `@/` resolves differently for main vs renderer (configured in `tsconfig.node.json` vs `tsconfig.web.json`). The root `tsconfig.json` also defines renderer-only convenience aliases (`@/components`, `@/lib`, `@/hooks`).

## Reference Projects

**IMPORTANT**: How to use Reference Projects

1. If you have any questions or need to look up information on AI SDK, Assistant UI, Browser Use project,
   the information is listed in this section below.
2. If you cannot find information in the list below, you will NOT be able to find them online either.
3. Preferred sequence of looking up: example -> docs -> api reference -> source code.
4. Do not look for information from web.

- `reference/ai`: AI SDK reference.
  - Source code in `reference/ai/packages/ai/src`
  - Documentation in `reference/ai/docs`
  - Design pattern and examples in `reference/ai/content/cookbook` and `reference/ai/examples`
    - for this project, `reference/ai/examples/express` will be valuable.
  - Providers in `reference/ai/content/providers`
- `reference/assitant-ui`: Assistant UI React Component Library.
  - Source code in `reference/assitant-ui/packages`
  - Documentation in `reference/assitant-ui/apps/docs/content/docs`
  - Design pattern and examples in `reference/assitant-ui/examples`
- `reference/browser-use`: Browser-use project
  - Source code in `reference/browser-use`
  - Documentation in `reference/browser-use/docs`
  - Examples in `reference/browser-use/examples`
- `reference/p-queue`: p-queue library reference, used for queue main process operations
  - api docs is `reference/p-queue/readme.md`
  - source code is `reference/p-queue/source`
- `reference/drizzle`: Drizzle ORM reference.
  - Source code in `reference/drizzle/drizzle-orm/src` (SQLite core in `drizzle-orm/src/sqlite-core/`)
  - Documentation in `reference/drizzle/docs`
- `reference/tool-ui`: Tool UI component library (used for agent tool cards in the renderer).
  - Source code in `reference/tool-ui/packages/agent`
  - Documentation in `reference/tool-ui/apps/www/app/docs` (per-component: approval-card, citation, plan, option-list, etc.)
- `reference/electron-vite-docs/packages/en-US/docs`: electron-vite documents
- `reference/electron-vite/src`: electron-vite source code
- `reference/langfuse-docs`: Langfuse documents

## Important Technical Details

- Renderer↔main communication is HTTP REST + SSE only — there is **no Electron IPC** (preload is a no-op).
- Electron security: context isolation enabled, nodeIntegration disabled. `sandbox` is currently `false` (preload is already a no-op, so enabling `sandbox: true` is a tracked follow-up).
- WebView tags are disabled for security; use `WebContentsView` instead.
- **Run modes**: standalone (`127.0.0.1` + random port, local) vs remote access (network bind on configurable host/port, default `0.0.0.0:8787`, with optional password auth).
- Build tooling is electron-vite. Main-process `externalizeDeps` excludes `drizzle-orm` (it is bundled); the renderer dedupes `@assistant-ui/*` plus `react`/`react-dom`. The dev server runs on port 7777.
- Custom Vite plugins in `electron.vite.config.ts`: `bindingSqlite3` (copies `better_sqlite3.node` to `out/main/`; supports cross-platform builds via the `NATIVE_BINDING_TARGET` env var by downloading prebuilt binaries, cached under `native/`), `copyMigrations` (`drizzle/` → `out/main/drizzle/`), `watch-main-reload`.
- Tailwind CSS v4 (via `@tailwindcss/vite` plugin, not PostCSS).
- Logging: `electron-log/main` with scoped loggers (e.g., `log.scope("ApiServer")`).
- Drizzle ORM (1.0.0-beta.22) with SQLite dialect; migrations live in `drizzle/`.
- Tooling: ESLint flat config (`eslint.config.ts`) with types-eslint recommended; it ignores the vendored `components/ui/` and `components/assistant-ui/` directories. Prettier config lives in `package.json` (2-space indent, no tabs). Repo helper scripts live in `scripts/` (e.g., `build-all-platforms.js`, `postinstall.js`).
- Packaging (`electron-builder.json`): appId `com.upwindchange.Autai`; asar with `better_sqlite3.node` unpacked; Windows NSIS (x64 + arm64), Linux AppImage (x64 + arm64), macOS zip; Flatpak target; published to GitHub (`upwindchange/Autai`).
- Stack highlights: React 19, TypeScript 6, @assistant-ui/react 0.14 + @assistant-ui/react-ai-sdk, Zustand 5, Zod 4, Hono, better-sqlite3, p-queue, electron-log, electron-updater, Langfuse, @ai-sdk/mcp, i18next/react-i18next, the streamdown suite (cjk/code/math/mermaid) with remark-gfm + KaTeX, and react-hook-form.
