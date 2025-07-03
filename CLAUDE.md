# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Core Development

-   `npm run dev` - Start development environment with Vite HMR and Electron in watch mode
-   `npm run build` - Full production build: TypeScript compilation → Vite build → Electron Builder packaging
-   `npm run preview` - Preview production build
-   `npm run pretest` - Build in test mode for testing
-   `npm run test` - Run Vitest unit tests

### Testing

-   Unit tests use Vitest framework
-   E2E tests use Playwright for Electron testing
-   Test files located in `test/` directory

## Architecture Overview

### Multi-Process Electron Application

This is an **AI-powered browser** built with Electron + React + Vite that combines web browsing with conversational AI assistance.

**Main Process** (`electron/main/index.ts`):

-   Manages BrowserWindow and WebContentsView instances for web pages
-   Integrates LangChain AI agent service (`agent.ts`) with OpenAI integration
-   Handles IPC communication for navigation, AI chat, and link hints
-   Uses Map-based view management with composite keys (taskIndex + pageIndex)

**Renderer Process** (`src/`):

-   React 19 application with TypeScript
-   Resizable panel layout: sidebar (tasks/navigation) + main content + AI chat panel
-   Uses shadcn/ui component library built on Radix UI primitives
-   Tailwind CSS for styling with modern CSS-in-JS patterns

**Preload Script** (`electron/preload/index.ts`):

-   Secure IPC bridge using contextBridge
-   Exposes sanitized APIs to renderer process

### Key Technologies

-   **Electron 36.4.0** - Desktop app framework
-   **React 19.1.0** with hooks - UI library
-   **LangChain** - AI/ML framework with OpenAI integration
-   **Vite 6.3.5** - Build tool with HMR
-   **TypeScript 5.8.3** - Type safety
-   **shadcn/ui + Radix UI** - Modern component library
-   **Tailwind CSS 4.1.10** - Utility-first styling

### Core Features

1. **Web Browser Integration**: Custom WebContentsView management for displaying web pages
2. **AI Conversational Interface**: LangChain-powered chat with conversation memory
3. **Vim-style Link Hints**: Keyboard navigation overlay for web pages (based on Vimium submodule)
4. **Task Management**: Sidebar-based organization of web pages and AI interactions

## Code Organization

### Main Directories

-   `electron/main/` - Main process code (window management, AI agent, IPC handlers)
-   `electron/preload/` - Preload scripts for secure IPC bridge
-   `src/components/` - React components including UI library and AI chat interface
-   `src/components/genai/` - AI chat interface components
-   `src/components/ui/` - shadcn/ui component library
-   `src/lib/` - Utility libraries and helpers
-   `src/hooks/` - Custom React hooks
-   `src/vimium/` - Vimium browser extension (Git submodule) for reference, not using it.
-   `test/` - E2E tests with Playwright

### Key Files

-   `electron/main/agent.ts` - LangChain AI service integration
-   `src/components/link-hints-wrapper.tsx` - Web link hint overlay system
-   `src/components/sidebar-left.tsx` - Navigation and task management sidebar
-   `src/components/genai/genai.tsx` - AI chat interface component

## Development Patterns

### IPC Communication

-   Main ↔ Renderer communication via IPC with type-safe handlers
-   AI agent interactions flow through main process for security
-   WebContentsView management handled in main process

### React Patterns

-   Modern hooks-based components (React 19)
-   TypeScript with strict typing using path aliases (`@/*` → `src/*`)
-   Component composition with shadcn/ui patterns
-   Resizable panels for flexible UI layout

### AI Integration

-   LangChain agent service in main process
-   Conversation memory and state management
-   OpenAI API integration for language model capabilities

### Build Process

1. TypeScript compilation (`tsc`)
2. Vite builds renderer process with HMR in development
3. Electron Builder packages final application for distribution

## Vimium Integration

-   Git submodule at `src/vimium/` provides keyboard navigation reference
-   Link hints overlay system for web page interaction
-   Vim-style keyboard shortcuts for browser navigation
-   This submodule is stored for implementation reference, not calling any of its implemenation from the current code base.
