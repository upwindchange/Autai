# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Autai is an "Automatic AI Agent Driven Browser" - an Electron-based desktop application that integrates AI capabilities with web browsing functionality. It uses a multi-process architecture with React for the UI and LangChain for AI orchestration.

## Essential Commands

```bash
# Development
npm run dev          # Start development server with hot reload

# Testing
npm run test         # Run Vitest tests
npm run lint         # Run ESLint checks

# Building
npm run build        # Full production build (TypeScript → Vite → Electron)
npm run preview      # Preview production build locally

# Testing a single file
npx vitest test/path/to/file.test.ts
```

**IMPORTANT INSTRUCTION**:

1. You are running in Linux environment, the current working directory (cwd) can be some windows path likely under `C:/`. If you saw this kind of path, this path is definitely wrong and guaranteed to fail. Your path to files should be a POSIX path.
2. `pnpm` commands is running in the Linux environment. However, the development is done in windows environment. Therefore, above commands should not be run by you to build/test anything. You should ask user to step in the loop and confirm if anything works by human in the loop.

## Architecture Overview

The application follows Electron's multi-process architecture:

### Main Process (`electron/main/`)

- **StateManager**: Central state coordination
- **Bridges**: IPC communication handlers (StateBridge, ViewBridge, AgentBridge)
- **Services**: Business logic (NavigationService, SettingsService, TaskAgentService)
- **Scripts**: Injected scripts like `hintDetector.js`

### Renderer Process (`src/`)

- **React Components**: UI layer using shadcn/ui components
- **State Management**: Zustand store synced with main process
- **Hooks**: Custom React hooks for app functionality

### Key Architectural Patterns

1. **Bridge Pattern**: All IPC communication goes through typed bridges

   - Example: `ViewBridge` manages WebContentsView lifecycle
   - Bridges emit events that sync state between processes

2. **Service Layer**: Business logic separated from IPC handling

   - Services handle complex operations
   - Bridges act as thin wrappers for IPC

3. **State Synchronization**:

   - Main process holds authoritative state
   - Changes emit events to renderer
   - Renderer updates optimistically then syncs

4. **Task-Based AI Integration**:
   - Each task represents a browsing session with AI assistance
   - Tasks maintain their own conversation history
   - AI agents stream responses using LangChain

## Development Guidelines

### Adding New Features

1. **New IPC Communication**:

   - Add types to `electron/shared/types/`
   - Create/update bridge in `electron/main/bridge/`
   - Add handler in relevant service
   - Update renderer store in `src/store/`

2. **New UI Components**:

   - Use shadcn/ui components when possible
   - Follow existing component patterns in `src/components/`
   - Use Tailwind CSS for styling

3. **AI/Agent Features**:
   - Implement in `TaskAgentService`
   - Use LangChain for LLM interactions
   - Stream responses using existing streaming patterns

### Code Conventions

- **TypeScript**: Strict mode enabled, use proper types
- **Path Aliases**: Use `@/` for `src/` imports
- **State Updates**: Always go through proper channels (no direct state mutation)
- **Error Handling**: Use try-catch and return Result objects with success/error states

### Security Considerations

- Context isolation is enabled
- Use `contextBridge` for all IPC communication
- External links open in default browser
- WebviewTag is disabled

## Common Development Tasks

### Working with WebContentsView

- Views are managed by `ViewBridge`
- Always set proper bounds when showing views
- Inject scripts using `executeJavaScript` after DOM ready

### Managing AI Conversations

- Each task has its own agent instance
- Use streaming for real-time responses
- Store conversation history per task

### Debugging

- Main process: Use VSCode debugger or console.log
- Renderer: Use Chrome DevTools
- IPC: Log events in both processes to trace flow

## Testing Approach

- **Unit Tests**: Use Vitest for service/utility testing
- **E2E Tests**: Playwright for full application flows
- **Platform Specific**: Some tests skip on Linux due to Electron limitations
