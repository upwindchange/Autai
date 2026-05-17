# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Autai is an "Automatic AI Agent Driven Browser" - a desktop application built with Electron, React, and TypeScript that enables AI-powered browser automation. It has two modes: **Browser Automation** (AI controls a real browser) and **Research Mode** (AI searches the web and synthesizes answers). The app is in active alpha development.

## Key Commands

**IMPORTANT**:

1. Do not run any pnpm command, ask the user to run it.
2. This project does not use npm, npx. It uses pnpm and pnpm dlx.
3. All files uses 2 whitespaces to indent, not tab.
4. All files, except for windows .bat and .cmd files, use LF as end of line, not CRLF.

```bash
# Development
pnpm dev          # Start development server with hot reload
pnpm build        # Build production app (electron-vite build + electron-builder)
pnpm tsc          # Type-check both main and renderer processes
pnpm lint         # Run ESLint checks
pnpm format       # Run prettier formatter on src/

# Database
pnpm db:generate  # Generate drizzle migrations from schema changes
```

## Architecture

### Multi-Process Design

- **Main Process** (`src/main/`): Electron main process — manages windows, native APIs, core services, and the AI agent system
- **Renderer Process** (`src/renderer/`): React app — UI layer with TypeScript, Tailwind CSS v4, and @assistant-ui/react
- **Preload** (`src/preload/`): Context bridge for secure IPC via `@electron-toolkit/preload`
- **Shared** (`src/shared/`): Type definitions shared between main and renderer (`ipc.ts`, `chat.ts`, `session.ts`, `settings.ts`, `tools.ts`)

### Main Process

The main process initializes in `src/main/index.ts` with this startup sequence: app ready → splash screen → BrowserWindow → services (SessionTabService, TabControlService, PQueueManager) → IPC bridges → API server (Hono on random port).

**IPC Bridges** (`src/main/bridges/`): Each bridge extends `BaseBridge` which provides typed `handle`/`on` registration with error handling.

- `SessionTabBridge` — thread lifecycle, view visibility, bounds
- `HitlBridge` — human-in-the-loop responses

**Agent System** (`src/main/agents/`):

- `apiServer.ts` — Hono server serving REST routes on a random port, bound to `127.0.0.1`
- `routes/` — REST endpoints: `chatRoutes`, `threadRoutes`, `tagRoutes`, `settingsRoutes`, `providerRoutes`
- `providers/` — AI provider factory (`provider.ts`) and registry (`registry.ts`); providers loaded from SQLite, not config files
- `workers/` — Chat workers that handle streaming:
  - `chatWorker.ts` — base chat worker
  - `browserWorker/browser-use/` — browser automation (planner → task-executor → action-executor)
  - `browserWorker/browser-research/` — research mode (search-agent → planner → summarizer → result-extractor)
- `tools/` — Agent tools organized by domain: `DOMTools`, `InteractiveTools` (click/fill/hover/drag/scroll), `SessionTabTools`, `TabControlTools`, `HitlTools`
- `schemas/apiSchemas.ts` — Zod schemas for API validation

**Services** (`src/main/services/`):

- `SessionTabService` — manages browser tabs per session, integrates with DomService and ElementInteractionService
- `TabControlService` — tab navigation
- `settingsService` — provider and model configuration persistence
- `threadPersistenceService` — message persistence to SQLite
- `threadIntelligenceService` — automatic thread tagging and renaming
- `searchService` — web search
- `HitlService` — human-in-the-loop pause/resume

**Database** (`src/main/db/`):

- SQLite via better-sqlite3 with Drizzle ORM
- Schema in `schema.ts`: `settings` (key-value), `userProviders`, `modelAssignments` (per-role model selection), `threads`, `messages`, `tags`, `threadTags` (many-to-many)
- Migrations generated to `drizzle/` via `pnpm db:generate`, copied to `out/main/drizzle/` at build time
- Custom Vite plugins in `electron.vite.config.ts` handle native binding copy (`bindingSqlite3`) and migration copy (`copyMigrations`)

### Renderer Process

Built on @assistant-ui/react with custom components.

**State Management** (`src/renderer/stores/`):

- `uiStore` — settings visibility, container bounds, browser/webSearch toggle (mutually exclusive), split view state
- `tagStore` — tag CRUD, thread-to-tag mapping, search, multi-select

**Key Component Areas**:

- `components/ai-chat/` — main chat UI: thread, markdown rendering, attachments, welcome screen
- `components/assistant-ui/` — vendored from @assistant-ui/react (do not modify directly; copy out if changes needed)
- `components/tool-ui/` — tool-specific UI cards: approval, citation, input, option-list, plan
- `components/settings/` — provider/model configuration
- `components/side-bar/` — thread list, tag management
- `components/ui/` — shadcn/ui base components (Tailwind-based)
- `adapters/backendThreadListAdapter.tsx` — REST adapter connecting assistant-ui's RemoteThreadListAdapter to the Hono API

### TypeScript Path Aliases

| Alias                  | Points To          | Used In          |
| ---------------------- | ------------------ | ---------------- |
| `@/`, `@/*`            | `src/main/`        | Main process     |
| `@agents`, `@agents/*` | `src/main/agents/` | Main process     |
| `@/`, `@/*`            | `src/renderer/`    | Renderer process |
| `@shared`, `@shared/*` | `src/shared/`      | Both processes   |

Note: `@/` resolves differently for main vs renderer (configured in `tsconfig.node.json` vs `tsconfig.web.json`).

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

- Electron security: context isolation enabled, nodeIntegration disabled
- WebView tags are disabled for security; use WebContentsView instead
- All browser automation runs in isolated contexts with proper sandboxing
- The project uses electron-vite for building and bundling
- Tailwind CSS v4 (via `@tailwindcss/vite` plugin, not PostCSS)
- Logging: `electron-log/main` with scoped loggers (e.g., `log.scope("ApiServer")`)
- Drizzle ORM beta version (1.0.0-beta) with SQLite dialect
