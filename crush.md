# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Autai is an "Automatic AI Agent Driven Browser" - a desktop application built with Electron, React, and TypeScript that enables AI-powered browser automation.

## Key Commands

**IMPORTANT**: Do not run any command, ask the user to run it.

```bash
# Development
pnpm dev          # Start development server with hot reload
pnpm build        # Build production app
pnpm test         # Run tests with Vitest
pnpm lint         # Run ESLint checks

# Building & Packaging
pnpm build
```

## Architecture

### Multi-Process Design

- **Main Process** (Electron): Manages windows, native APIs, and core services
- **Renderer Process** (React): UI layer with TypeScript and Tailwind CSS
- **Bridge Pattern**: IPC communication through preload scripts and typed channels

### Core Services

- **BrowserViewService**: Manages browser view instances and navigation
- **DomService**: Analyzes and manipulates DOM elements in webviews
- **SettingsService**: Manages application settings and providers
- **ThreadViewManager**: Manages AI thread views and their lifecycle
- **Agent API Server**: Express server for AI agent communication

### Directory Structure

```
electron/
├── main/          # Main process code
│   ├── bridge/    # IPC bridges for typed communication
│   ├── scripts/   # DOM tree building script the agent ai
│   └── services/  # Core application services
│       ├── agent/ # AI agent server implementation
│       └── dom/   # DOM manipulation services
├── preload/       # Preload scripts
shared_types/      # TypeScript type definitions between main and renderer
src/
├── components/    # React components
│   ├── ai-chat/   # AI chat interface
│   ├── ui/        # shadcn/ui components (Tailwind-based)
│   ├── assistant-ui/ # assistant-ui components (do not modify, if need to modify, copy it out)
│   ├── settings/  # Settings management UI
│   └── side-bar/  # Sidebar navigation components
├── stores/        # Zustand state management
├── hooks/         # Custom React hooks
├── lib/           # Utility functions
└── vite-env.d.ts  # IPC type definitions: if there is a new IPC endpoint, add type definition here
reference/         # several projects for reference
```

## Development Guidelines

### TypeScript

- Strict mode enabled
- Use `@/` path alias for imports from `src/`
- Use `@shared/index` path alias for any type imports from `shared_types/`
- All IPC channels must be typed in `src/vite-env.d.ts`

### State Management

- Zustand stores in `src/stores/`
- Use typed actions and selectors

### Reference projects

**IMPORTANT**: How to use Reference Projects

1. If you have any questions or need to look up infomation on AI SDK, Assistant UI, Browser Use project,
   the infomation are listed in this section below.
2. If you cannot find information in the list below, you will NOT be able to find them online either.
3. Preferred sequence of looking up: example -> docs -> api reference -> source code.
4. Do not look for information from web unless you absolutely have to.

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
    - For this project, we will only use `reference/assitant-ui/examples/with-ai-sdk`
- `reference/browser-use`: Browser-use project
  - Source code in `reference/browser-use`
  - Documentation in `reference/browser-use/docs`
  - Examples in `reference/browser-use/examples`

## Important Technical Details

- Custom Vite plugin builds injected scripts separately
- Electron security: context isolation enabled, nodeIntegration disabled
- WebView tags are disabled for security; use BrowserView instead
- All browser automation runs in isolated contexts with proper sandboxing
