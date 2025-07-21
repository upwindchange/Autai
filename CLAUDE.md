# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Autai is an "Automatic AI Agent Driven Browser" - a desktop application built with Electron, React, and TypeScript that enables AI-powered browser automation.

## Key Commands

```bash
# Development
pnpm run dev          # Start development server with hot reload
pnpm run build        # Build production app
pnpm run test         # Run tests with Vitest
pnpm run lint         # Run ESLint checks

# Building & Packaging
pnpm run build:win    # Build for Windows
pnpm run build:mac    # Build for macOS
pnpm run build:linux  # Build for Linux
```

## Architecture

### Multi-Process Design

- **Main Process** (Electron): Manages windows, native APIs, and core services
- **Renderer Process** (React): UI layer with TypeScript and Tailwind CSS
- **Bridge Pattern**: IPC communication through preload scripts and typed channels

### Core Services

- **DomService**: Analyzes and manipulates DOM elements in webviews
- **StateService**: Synchronizes state between main and renderer processes using Zustand
- **WebViewService**: Manages browser webview instances and navigation

### Directory Structure

```
electron/
├── main/          # Main process code
│   ├── bridge/    # IPC bridges for typed communication
│   └── services/  # Core application services
├── preload/       # Preload scripts
src/
├── components/    # React components
│   ├── ai-chat/   # AI chat interface
│   ├── ui/        # shadcn/ui components
│   └── assistant-ui/ # assistant-ui components
└── store/         # Zustand state management
browser-use/       # Python browser automation library for reference only
```

## Development Guidelines

### TypeScript

- Strict mode enabled
- Use `@/` path alias for imports from `src/`
- All IPC channels must be typed in `shared/types.ts`

### State Management

- Zustand stores in `src/store/`
- State syncs between processes via StateService
- Use typed actions and selectors

### Browser Automation

- The `browser-use` directory contains a Python library (requires Python >= 3.11)
- See `browser-use/CLAUDE.md` for specific guidelines when working with that code
- DOM manipulation happens through injected scripts in `electron/main/scripts/`

### Testing

- Vitest for unit tests
- Playwright for E2E tests
- Run specific test: `npm run test -- path/to/test`

## Important Technical Details

- Custom Vite plugin builds injected scripts separately
- Electron security: context isolation enabled, nodeIntegration disabled
- WebView tags are disabled for security; use BrowserView instead
- All browser automation runs in isolated contexts with proper sandboxing
