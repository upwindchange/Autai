# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Autai is an Electron-based desktop application that provides an AI-powered browser with integrated chat functionality. The application allows users to interact with AI agents that can help browse and analyze web content.

## Development Commands

### Essential Commands

```bash
# Install dependencies
pnpm install

# Start development server (Electron + Vite with HMR)
pnpm dev

# Build the application
pnpm build

# Run tests
pnpm test

# Preview production build
pnpm preview
```

**IMPORTANT INSTRUCTION**:

1. You are running in Linux environment, the current working directory (cwd) can be some windows path likely under `C:/`. If you saw this kind of path, this path is definitely wrong and guaranteed to fail. Your path to files should be a POSIX path.
2. `pnpm` commands is running in the Linux environment. However, the development is done in windows environment. Therefore, above commands should not be run by you to build/test anything. You should ask user to step in the loop and confirm if anything works by human in the loop.

### Build Output

- `dist/` - Built React application
- `dist-electron/` - Built Electron main and preload scripts
- `release/{version}/` - Packaged applications (.dmg/.zip for Mac, .exe for Windows)

## Architecture Overview

### Process Architecture

The application follows Electron's multi-process architecture:

1. **Main Process** (`electron/main/`)

   - Manages application lifecycle
   - Handles IPC communication
   - Controls web views and navigation
   - Manages AI agent services

2. **Renderer Process** (`src/`)

   - React application with shadcn/ui components
   - Communicates with main process via IPC
   - Handles UI state and user interactions

3. **Preload Scripts** (`electron/preload/`)
   - Bridge between main and renderer processes
   - Exposes safe APIs to renderer

### Key Services and Handlers

The application uses a service-handler pattern for IPC communication:

- **NavigationService/Handler**: Controls web view navigation
- **ViewManagerService/Handler**: Manages multiple web views
- **StreamingAgentService/Handler**: Handles AI model interactions with streaming responses
- **TaskAgentManager**: Manages task-specific AI agent instances
- **SettingsService/Handler**: Manages application settings and profiles

### Frontend Architecture

- **Context API**: Task management via `TasksContext`
- **Settings Context**: Profile and API key management
- **AI Chat Components**: Modular chat interface with streaming support
- **UI Components**: shadcn/ui components based on Radix UI

### Important Files

- `electron/main/index.ts` - Main process entry point
- `electron/main/scripts/hintDetector.js` - Browser automation script injected into web views
- `src/contexts/tasks-context.tsx` - Central task state management
- `src/components/ai-chat/` - AI chat interface implementation
- `src/components/settings/` - Settings management UI

### AI Integration

The application integrates with OpenAI-compatible APIs using LangChain:

- Supports streaming responses
- Configurable models (simple vs complex)
- Task-specific agent instances with isolated contexts
- Profile-based API key management

### TypeScript Configuration

- Strict mode enabled
- Path alias: `@/*` maps to `src/*`
- Separate configs for Node.js (electron) and browser (React) environments

### Testing

- Unit tests with Vitest
- E2E tests with Playwright
- Test files in `test/` directory
- Run tests before builds to ensure quality

## Development Tips

1. When modifying IPC communication, update both the handler (main process) and the corresponding API calls (renderer process)
2. The `hintDetector.js` script is injected into web views for browser automation - modifications require rebuilding
3. Use the existing service-handler pattern when adding new IPC functionality
4. Task agents are isolated by task ID - each task has its own conversation context
5. Settings are persisted using Electron's app.getPath('userData') directory
