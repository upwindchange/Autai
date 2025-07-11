# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Autai** is an Automatic AI Agent Driven Browser built with Electron, React, TypeScript, and Vite. It provides a desktop application that manages tasks, browser views, and AI agents for automated web interactions.

### Tech Stack

- **Desktop Framework**: Electron v37.2.0
- **Frontend**: React v19.1.0 with TypeScript
- **Build Tool**: Vite v7.0.4
- **UI Components**: Radix UI + Tailwind CSS v4.1.11
- **State Management**: Zustand v5.0.6
- **AI Integration**: LangChain with OpenAI
- **Testing**: Vitest + Playwright

## Common Development Commands

```bash
# Install dependencies
pnpm install

# Development mode with hot reload
pnpm dev

# Build production application
pnpm build

# Run tests
pnpm test

# Run a single test file
pnpm test test/e2e.spec.ts

# Preview production build
pnpm preview

# Package application for distribution
pnpm dist

# Type check
pnpm typecheck

# Lint code
pnpm lint
```

**IMPORTANT INSTRUCTION**:

1. You are running in Linux environment, the current working directory (cwd) can be some windows path likely under `C:/`. If you saw this kind of path, this path is definitely wrong and guaranteed to fail. Your path to files should be a POSIX path.
2. `pnpm` commands is running in the Linux environment. However, the development is done in windows environment. Therefore, above commands should not be run by you to build/test anything. You should ask user to step in the loop and confirm if anything works by human in the loop.

## Architecture Overview

### Core Domain Model

The application follows a **Task-View-Agent** architecture:

1. **Tasks**: Top-level containers representing user workflows

   - Each task can have multiple pages
   - Tasks maintain their own state and history
   - Stored in `StateManager` with unique IDs

2. **Views**: Browser instances (WebContentsView) managed by Electron

   - Each view corresponds to a rendered web page
   - Views are created/destroyed dynamically based on active tasks
   - Managed through `electron/main/services/viewService.ts`

3. **Agents**: AI-powered automation components

   - Use LangChain for orchestration
   - Stream responses in real-time
   - Interact with browser views through injected scripts

4. **Pages**: Individual web pages within a task
   - Track URL, title, and navigation state
   - Support browser history (back/forward)

### Multi-Process Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Main Process (Node.js)                │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │StateManager │  │ViewService   │  │NavigationSvc  │  │
│  └─────────────┘  └──────────────┘  └───────────────┘  │
│           │               │                   │          │
│           └───────────────┴───────────────────┘          │
│                           │                              │
│                      IPC Bridge                          │
└───────────────────────────┼─────────────────────────────┘
                            │
┌───────────────────────────┼─────────────────────────────┐
│                    Preload Script                        │
│                 (Secure API Exposure)                    │
└───────────────────────────┼─────────────────────────────┘
                            │
┌───────────────────────────┼─────────────────────────────┐
│                 Renderer Process (Chromium)              │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │React App    │  │Zustand Store │  │UI Components  │  │
│  └─────────────┘  └──────────────┘  └───────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### State Synchronization

State flows unidirectionally from Main → Renderer:

1. State changes occur in `StateManager` (main process)
2. Changes are broadcast via IPC events
3. Renderer updates Zustand store
4. React components re-render automatically

### Key Services and Their Responsibilities

#### Main Process Services

1. **StateManager** (`electron/main/services/StateManager.ts`)

   - Central source of truth for all application state
   - Manages tasks, views, agents, and settings
   - Persists state to disk
   - Broadcasts state changes to renderer

2. **ViewService** (`electron/main/services/viewService.ts`)

   - Creates and manages WebContentsView instances
   - Handles view lifecycle (create, show, hide, destroy)
   - Manages view positioning and sizing
   - Injects scripts for browser automation

3. **NavigationService** (`electron/main/services/navigationService.ts`)

   - Handles all browser navigation (back, forward, reload, stop)
   - Updates page state on navigation events
   - Manages URL changes and redirects

4. **StreamingAgentService** (`electron/main/services/streamingAgentService.ts`)
   - Integrates LangChain for AI functionality
   - Handles streaming responses from AI models
   - Manages agent lifecycle and state

#### Renderer Process Components

1. **AppStore** (`src/store/appStore.ts`)

   - Zustand store mirroring main process state
   - Provides hooks for React components
   - Handles optimistic updates for UI responsiveness

2. **MainLayout** (`src/components/main-layout.tsx`)

   - Root layout component
   - Manages sidebar, main content area
   - Handles responsive design

3. **TaskManager** (`src/components/task-manager.tsx`)
   - UI for creating and managing tasks
   - Displays task list and active pages
   - Handles task selection and deletion

### IPC Communication Patterns

All IPC communication follows these patterns:

1. **State Sync**: `state:update` events from main → renderer
2. **Commands**: `invoke` from renderer → main for actions
3. **Navigation**: Dedicated navigation commands (back, forward, etc.)
4. **Settings**: Separate channel for user preferences

Example IPC usage:

```typescript
// Renderer → Main (command)
await window.electronAPI.createTask({ name: "New Task" });

// Main → Renderer (state update)
mainWindow.webContents.send("state:update", newState);
```

## Testing Strategy

### Unit Tests

- Test individual services and utilities
- Mock IPC communication for isolated testing
- Focus on business logic validation

### E2E Tests

- Use Playwright to test full application flow
- Test task creation, navigation, and AI interactions
- Verify state synchronization between processes

### Running Tests

```bash
# All tests
pnpm test

# Watch mode
pnpm test:watch

# E2E only
pnpm test:e2e
```

## Development Tips

### Working with Electron

- Changes to main process require app restart
- Use `pnpm dev` for hot reload of renderer
- Check DevTools console for renderer errors
- Check terminal for main process errors

### State Management

- All state mutations must go through StateManager
- Never modify state directly in renderer
- Use IPC commands to trigger state changes
- State is automatically persisted to disk

### Adding New Features

1. Define types in `electron/shared/types.ts`
2. Add state management in `StateManager`
3. Create IPC handlers in relevant service
4. Update preload script if new API needed
5. Add UI components in renderer
6. Write tests for new functionality

### Browser Automation

- Scripts injected via `webContents.executeJavaScript()`
- Hint detection script at `electron/main/scripts/hintDetector.js`
- Use `viewService.executeInView()` for script execution

## Important Conventions

### Code Style

- TypeScript strict mode enabled
- Use async/await over promises
- Prefer functional components with hooks
- Follow existing file naming patterns

### Security

- All IPC APIs must be explicitly exposed in preload
- No direct Node.js access in renderer
- Validate all IPC inputs
- Use context isolation

### Performance

- Lazy load heavy components
- Use React.memo for expensive renders
- Debounce frequent state updates
- Profile with Chrome DevTools
