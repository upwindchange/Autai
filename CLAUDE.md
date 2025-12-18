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
src/
├── main/              # Main process code
│   ├── agents/        # AI agent implementation
│   │   ├── providers/ # AI provider integrations
│   │   ├── telemetry/ # Telemetry and tracking
│   │   ├── utils/     # Agent utilities
│   │   └── workers/   # Worker threads for agents
│   ├── bridges/       # IPC bridges for typed communication
│   ├── services/      # Core application services
│   └── utils/         # Main process utilities
├── preload/           # Preload scripts
├── renderer/          # Renderer process (React app)
│   ├── components/    # React components
│   │   ├── ai-chat/   # AI chat interface
│   │   ├── assistant-ui/ # assistant-ui components (do not modify, if need to modify, copy it out)
│   │   ├── settings/  # Settings management UI
│   │   ├── side-bar/  # Sidebar navigation components
│   │   └── ui/        # shadcn/ui components (Tailwind-based)
│   ├── stores/        # Zustand state management
│   ├── hooks/         # Custom React hooks
│   ├── lib/           # Utility functions
│   └── transports/    # Communication transports
└── shared/            # Shared TypeScript type definitions
    ├── chat.ts        # Chat-related types
    ├── ipc.ts         # IPC communication types
    ├── logger.ts      # Logging types
    ├── settings.ts    # Settings types
    ├── session.ts     # Browser session management types
    └── tools.ts       # Tool-related types
reference/             # Several projects for reference
```

## Development Guidelines

### TypeScript

- Strict mode enabled
- Path aliases configuration:
  - **Main process**: 
    - `@/` and `@/*` for imports from `src/main/`
    - `@agents` and `@agents/*` for agent-related imports
  - **Renderer process**: 
    - `@/*` for imports from `src/renderer/`
  - **Shared**: 
    - `@shared` and `@shared/*` for shared type imports from `src/shared/`
- All IPC channels must be properly typed

### State Management

- Zustand stores in `src/renderer/stores/`
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
- `reference/langchainjs`: langchain.js project
  - Documentation in `reference/langchainjs/docs`
  - Examples in `reference/langchainjs/examples`
- `reference/assitant-ui`: Assistant UI React Component Library.
  - Source code in `reference/assitant-ui/packages`
  - Documentation in `reference/assitant-ui/apps/docs/content/docs`
  - Design pattern and examples in `reference/assitant-ui/examples`
    - For this project, we will only use `reference/assitant-ui/examples/with-ai-sdk`
- `reference/browser-use`: Browser-use project
  - Source code in `reference/browser-use`
  - Documentation in `reference/browser-use/docs`
  - Examples in `reference/browser-use/examples`
- `reference\p-queue`: p-queue library reference, used for queue main process operations
  - api docs is `reference\p-queue\readme.md`
  - source code is `reference\p-queue\source`
- `reference\electron-vite-docs\packages\en-US\docs`: electron-vite documents
- `reference\electron-vite\src`: electron-vite source code
- `reference\langfuse-docs`: Langfuse documents

## Important Technical Details

- Electron security: context isolation enabled, nodeIntegration disabled
- WebView tags are disabled for security; use WebContentView instead
- All browser automation runs in isolated contexts with proper sandboxing
- The project uses electron-vite for building and bundling
