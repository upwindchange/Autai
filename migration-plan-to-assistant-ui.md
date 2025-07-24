# Migration Plan: From AppStore to Assistant-UI Ecosystem

## Overview

This plan details the complete migration from the current appStore-based architecture to the assistant-ui ecosystem. The migration will preserve essential functionality while leveraging assistant-ui's thread and runtime management capabilities.

## Phase 1 (**Completed!**): Create New State Management for UI & Settings

### 1.1 Create a minimal UI store (`src/stores/uiStore.ts`) for:

- `showSettings` state and toggle action
- `containerRef` and `containerBounds` management
- View visibility state (`isViewHidden`)
- Active tab/window state management

### 1.2 Update affected components:

- `App.tsx` - Use new uiStore for settings toggle
- `settings-button.tsx` - Use new uiStore
- `use-view-visibility.ts` - Use new uiStore

### 1.3 Remove initialization-related components:

- Remove initialization state from appStore

## Phase 2 (Not Going to Do!): Integrate Browser Context with Assistant-UI

### 2.1 Extend the assistant runtime to include browser context:

- Create a custom runtime wrapper that includes current URL, page title
- Pass browser context with each message to the API

### 2.2 Create browser-specific message components:

- Navigation status messages
- Page screenshot displays
- DOM analysis results

### 2.3 Implement browser actions as assistant tools:

- Navigate to URL
- Take screenshot
- Analyze page
- Extract information

## Phase 3: Build New Thread-View Architecture from Scratch

### 3.1 Create ThreadViewManager service (NEW):

```typescript
// Complete replacement for WebViewService
class ThreadViewManager {
  // Core data structures
  private threadViews: Map<threadId, Set<viewId>>;
  private viewMetadata: Map<viewId, ViewMetadata>;
  private windows: Map<windowId, BrowserWindow>;

  // Thread lifecycle integration
  subscribeToThreadEvents(runtime: AssistantRuntime);
  onThreadCreated(threadId: string);
  onThreadDeleted(threadId: string);
  onThreadSwitched(threadId: string);
}
```

### 3.2 Create BrowserViewManager service (NEW):

```typescript
// Handles all WebContentsView operations
class BrowserViewManager {
  private views: Map<viewId, WebContentsView>;

  createView(config: ViewConfig): WebContentsView;
  destroyView(viewId: string): void;
  navigateView(viewId: string, url: string): Promise<void>;
  executeInView(viewId: string, script: string): Promise<any>;
  captureScreenshot(viewId: string): Promise<Buffer>;
}
```

### 3.3 Create ViewOrchestrator service (NEW):

```typescript
// Coordinates between ThreadViewManager and BrowserViewManager
class ViewOrchestrator {
  // View operations
  createViewForThread(threadId: string, target: "tab" | "window"): string;
  switchToView(viewId: string): void;
  closeView(viewId: string): void;

  // Thread operations
  getActiveViewForThread(threadId: string): string | null;
  getAllViewsForThread(threadId: string): ViewInfo[];
}
```

### 3.4 Create new IPC architecture:

```typescript
// New IPC handlers - no legacy compatibility
interface ThreadViewAPI {
  // Thread operations
  "thread:created": (threadId: string) => void;
  "thread:switched": (threadId: string) => void;
  "thread:deleted": (threadId: string) => void;

  // View operations
  "view:create": (threadId: string, target: "tab" | "window") => string;
  "view:navigate": (viewId: string, url: string) => void;
  "view:execute": (viewId: string, action: BrowserAction) => any;
  "view:close": (viewId: string) => void;

  // Window operations
  "window:bounds": (viewId: string, bounds: Rectangle) => void;
  "window:visibility": (viewId: string, visible: boolean) => void;
}
```

### 3.5 Remove ALL existing view/webview services (move to backup folder):

- `electron/main/services/WebViewService.ts`
- `electron/main/bridge/ViewBridge.ts`
- all view-related code from StateManager
- all existing IPC handlers for views

## Phase 4: Remove Task/Page Management Infrastructure

### 4.1 Backend removal:

- Remove `electron/main/services/StateManager.ts`
- Remove `electron/main/bridge/TaskBridge.ts`
- Remove task/page related methods from `electron/main/bridge/ViewBridge.ts`
- Clean up `electron/main/bridge/StateBridge.ts` to remove task synchronization

### 4.2 Frontend removal:

- Remove entire `src/store` directory (appStore and all related files)
- Remove task-related IPC handlers

### 4.3 Remove all legacy view management:

- Delete any remaining view-related code
- Remove all WebContentsView references from old architecture
- Clean up any view-related state management

## Phase 5: Implement New Browser Integration

### 5.1 Build new browser components:

```typescript
// Browser state per view
interface BrowserState {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
}

// Tab management component
<BrowserTabs threadId={currentThreadId}>
  <TabList />
  <TabPanels />
  <NewTabButton />
</BrowserTabs>;
```

### 5.2 Implement browser tools for assistant:

```typescript
// Browser actions as assistant tools
const browserTools = {
  navigate: (url: string) => void
  screenshot: () => Buffer
  extractText: (selector?: string) => string
  click: (selector: string) => void
  type: (selector: string, text: string) => void
  waitFor: (selector: string, timeout?: number) => void
}
```

### 5.3 Create new UI architecture:

- `BrowserContainer`: Manages all views for current thread
- `BrowserTabBar`: Shows tabs with titles and close buttons
- `BrowserView`: Wrapper for WebContentsView positioning
- `BrowserControls`: Navigation buttons and URL bar
- `ViewOptionsMenu`: "Open in new tab/window" actions

## Phase 6: Testing & Cleanup

### 6.1 Test all functionality:

- Browser navigation through chat
- Multiple views per thread (tabs and windows)
- Thread lifecycle (creation, switching, deletion)
- View lifecycle (auto-creation, manual creation, cleanup)
- Settings panel toggle
- View visibility management

### 6.2 Final cleanup:

- Remove any dead code
- Update TypeScript types
- Clean up unused imports
- Update documentation

## Benefits of This Migration

1. **Thread-Based Architecture**: Each conversation thread can have multiple browser views
2. **Better Context**: Browser actions and state are preserved in conversation history
3. **Flexible View Management**: Support for tabs and windows per thread
4. **Automatic Lifecycle**: Views are created/destroyed with threads automatically
5. **Native Integration**: Leverage assistant-ui's runtime and thread management
6. **Cleaner Separation**: Main process manages views, renderer focuses on UI

## Risks & Mitigations

### Risk 1: Complex thread-view synchronization

**Mitigation**: Use clear ownership model - ViewThreadManager owns the mapping, WebViewService manages views

### Risk 2: Breaking existing functionality

**Mitigation**: Incremental migration with testing at each phase

### Risk 3: Memory usage with multiple views

**Mitigation**: Implement view limits per thread and lazy loading

## Implementation Order

1. Start with Phase 1 (new stores) - Low risk, doesn't break existing code
2. Implement Phase 2 (browser integration) - Adds new capabilities
3. Implement Phase 3 (thread-view management) - Core architectural change
4. Test thread-view integration thoroughly
5. Execute Phase 4 (task/page removal) - Higher risk but well-tested
6. Complete Phase 5 (browser refactoring) - Update to new model
7. Final Phase 6 (testing & cleanup) - Ensure everything works

## Current State Analysis

### Components Using appStore:

- `App.tsx` - For settings toggle and page URL display
- `use-view-visibility.ts` - For view visibility management
- `settings-button.tsx` - For settings toggle

### Electron-side Architecture:

- **StateManager**: Central state management for tasks, pages, views
- **WebViewService**: Manages WebContentsView instances
- **Bridge Classes**: IPC communication layer
- **StateBridge**: Orchestrates state synchronization

### Assistant-UI Integration:

- Currently using `useChatRuntime` from `@assistant-ui/react-ai-sdk`
- API endpoint: `http://localhost:3001/api/chat`
- Using assistant-ui primitives for thread UI components
- Supports tool calling and custom message components

## New Architecture Details (Complete Rewrite)

### Clean Architecture Layers:

```
Frontend (React + assistant-ui)
    ↓ IPC
Main Process Services:
├── ThreadViewManager (thread-view mapping)
├── BrowserViewManager (WebContentsView lifecycle)
├── ViewOrchestrator (coordination layer)
└── WindowManager (BrowserWindow management)
```

### Core Design Principles:

1. **No Legacy Code**: Complete removal of WebViewService, StateManager view code
2. **Thread-First**: All operations start from thread context
3. **Event-Driven**: Thread lifecycle drives view lifecycle automatically
4. **Clean Separation**: Each service has single responsibility
5. **Type-Safe IPC**: New typed channels with no backwards compatibility

### Data Flow Example:

```typescript
// User creates new thread
assistantRuntime.createThread()
  → ThreadViewManager.onThreadCreated(threadId)
    → ViewOrchestrator.createViewForThread(threadId, 'tab')
      → BrowserViewManager.createView(config)
        → Returns viewId to frontend
          → Frontend shows new tab

// User navigates in browser
browserTools.navigate(url)
  → IPC: view:navigate(viewId, url)
    → ViewOrchestrator.navigateView(viewId, url)
      → BrowserViewManager.navigateView(viewId, url)
        → WebContentsView.loadURL(url)
```

### Key Differences from Old Architecture:

1. **No Task/Page Concept**: Only threads and views exist
2. **No State Synchronization**: Views are ephemeral, state lives in threads
3. **Direct Thread Binding**: Views know their thread, threads track their views
4. **Simplified IPC**: One-way commands, no complex state sync
5. **Modern Patterns**: Uses assistant-ui runtime hooks and events

This complete rewrite eliminates all technical debt and creates a clean, maintainable architecture designed specifically for the assistant-ui ecosystem.
