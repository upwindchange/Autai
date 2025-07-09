# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Last Updated**: 2025-07-09 - Updated project structure with streaming AI architecture

## Development Commands

### Core Development

- `pnpm dev` - Start development environment with Vite HMR and Electron in watch mode
- `pnpm build` - Full production build: TypeScript compilation → Vite build → Electron Builder packaging
- `pnpm preview` - Preview production build
- `pnpm pretest` - Build in test mode for testing
- `pnpm test` - Run Vitest unit tests

**IMPORTANT INSTRUCTION**:

1. You are running in Linux environment, the current working directory (cwd) can be some windows path likely under `C:/`. If you saw this kind of path, this path is definitely wrong and guaranteed to fail. Your path to files should be a POSIX path.
2. `pnpm` commands is running in the Linux environment. However, the development is done in windows environment. Therefore, above commands should not be run by you to build/test anything. You should ask user to step in the loop and confirm if anything works by human in the loop.

### Testing

- Unit tests use Vitest framework
- E2E tests use Playwright for Electron testing
- Test files located in `test/` directory

## Architecture Overview

### Multi-Process Electron Application

This is an **AI-powered browser** built with Electron + React + Vite that combines web browsing with conversational AI assistance.

**Main Process** (`electron/main/index.ts`):

- Manages BrowserWindow and WebContentsView instances for web pages
- Integrates LangChain AI agent service
- Handles IPC communication for navigation, AI chat, and link hints
- Uses Map-based view management with composite keys (taskIndex + pageIndex)

**Renderer Process** (`src/`):

- React 19 application with TypeScript
- Resizable panel layout: sidebar (tasks/navigation) + main content + AI chat panel
- Uses shadcn/ui component library built on Radix UI primitives
- Tailwind CSS for styling with modern CSS-in-JS patterns

**Preload Script** (`electron/preload/index.ts`):

- Secure IPC bridge using contextBridge
- Exposes sanitized APIs to renderer process

### Key Technologies

- **Electron 36.4.0** - Desktop app framework
- **React 19.1.0** with hooks - UI library
- **LangChain** - AI/ML framework with OpenAI integration
- **LLM-UI Libraries** - Enhanced markdown and code rendering for AI responses
- **Vite 6.3.5** - Build tool with HMR
- **TypeScript 5.8.3** - Type safety
- **shadcn/ui + Radix UI** - Modern component library
- **Tailwind CSS 4.1.10** - Utility-first styling
- **@llm-ui/react, @llm-ui/code, @llm-ui/markdown** - Specialized LLM output rendering
- **shiki** - Syntax highlighting for code blocks
- **react-markdown & remark-gfm** - Markdown rendering with GitHub Flavored Markdown

### Core Features

1. **Web Browser Integration**: Custom WebContentsView management for displaying web pages
2. **AI Conversational Interface**: Streaming LangChain-powered chat with per-task conversation memory
3. **Vim-style Link Hints**: Keyboard navigation overlay for web pages (based on Vimium submodule)
4. **Task Management**: Sidebar-based organization of web pages and AI interactions

## Code Organization

### Main Directories

- `electron/main/` - Main process code (window management, AI agent, IPC handlers)
- `electron/preload/` - Preload scripts for secure IPC bridge
- `src/components/` - React components including UI library and AI chat interface
- `src/components/ai-chat/` - Streaming AI chat interface with modular block-based rendering
- `src/components/ui/` - shadcn/ui component library (DO NOT MODIFY - third-party library)
- `src/lib/` - Utility libraries and helpers
- `src/hooks/` - Custom React hooks
- `test/` - E2E tests with Playwright

### Key Files

- `electron/main/index.ts` - Main process entry point with window management
- `electron/main/services/` - Services
  - `agentService.ts` - Legacy LangChain AI service
  - `streamingAgentService.ts` - Streaming AI service with per-task agents
  - `taskAgentManager.ts` - Singleton manager for task-specific AI agents
  - `viewManagerService.ts` - WebContentsView lifecycle management, cleanup, and resource tracking
  - `navigationService.ts` - Web navigation and page metadata handling
  - `settingsService.ts` - AI settings and profile management
  - `markdownAgentService.ts` - Markdown-focused AI agent (being developed)
- `electron/main/handlers/` - IPC handlers for all main process services
  - `streamingAIHandler.ts` - Handles streaming AI chat interactions
  - `enhancedAIHandler.ts` - Advanced AI features (being developed)
- `src/App.tsx` - Main React application component with layout structure
- `src/components/sidebar-left.tsx` - Task management sidebar with WebContentsView coordination
- `src/components/ai-chat/` - Modular streaming chat components:
  - `chat-container.tsx` - Main chat container
  - `message-list.tsx` & `message-item.tsx` - Message display components
  - `input-box.tsx` - Chat input with streaming support
  - `blocks/` - Specialized content renderers (code, markdown, errors)
  - `hooks/use-task-chat.ts` - Per-task chat state management
- `src/components/nav-tasks.tsx` - Task navigation with collapsible page lists
- `src/components/settings/` - Settings UI with profile management

## Development Patterns

### IPC Communication

- Main ↔ Renderer communication via IPC with type-safe handlers
- AI agent interactions flow through main process for security
- WebContentsView management handled in main process

### React Patterns

- Modern hooks-based components (React 19)
- TypeScript with strict typing using path aliases (`@/*` → `src/*`)
- Component composition with shadcn/ui patterns
- Resizable panels for flexible UI layout

### AI Integration

- Streaming AI architecture with real-time token delivery
- Per-task agent instances with isolated conversation history
- Task-based memory management and cleanup
- OpenAI API integration with streaming support
- Modular content rendering for different message types

### Build Process

1. TypeScript compilation (`tsc`)
2. Vite builds renderer process with HMR in development
3. Electron Builder packages final application for distribution

### Architecture Insights

#### View Management System

The application uses a sophisticated view management system where:

- Each task can have multiple pages (WebContentsViews)
- Views are identified by composite keys: `taskId-pageIndex`
- ResizeObserver ensures views adapt to container size changes
- Only one view is visible at a time (others have empty bounds)

#### AI Integration Architecture

- Streaming AI service runs in main process for security
- Uses LangChain with OpenAI models (configurable)
- Per-task conversation isolation via TaskAgentManager
- Real-time token streaming with AsyncGenerator pattern
- Supports multiple model configurations via profiles
- Enhanced error handling and recovery mechanisms
- Modular message rendering with specialized content blocks

#### Settings System

- Profile-based settings management
- Multiple AI configuration profiles supported
- Settings persisted to disk via main process
- React Context API for settings state management

#### IPC Communication Patterns

- All IPC handlers follow consistent naming: `domain:action`
- Main process services exposed via dedicated handlers
- Preload script provides secure, limited IPC access
- Active view changes broadcast to renderer for UI updates
- Streaming events use `streaming-ai:*` namespace

## Important Instructions

### Do Not Modify

- **NEVER** modify any files in `src/components/ui/` - This is the shadcn/ui library folder
- These are third-party components that should remain untouched
- If UI component changes are needed, create new components that wrap or extend the base components

### New Components and Services

When adding new features:

1. Follow existing architectural patterns (streaming, per-task isolation)
2. Place AI-related components in `src/components/ai-chat/` or `src/components/ai/`
3. Add corresponding handlers in `electron/main/handlers/`
4. Maintain type safety with proper TypeScript definitions
5. Ensure proper cleanup in task deletion scenarios
