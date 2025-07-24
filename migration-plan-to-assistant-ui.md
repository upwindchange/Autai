# Migration Plan: From AppStore to Assistant-UI Ecosystem

## Overview

This plan details the complete migration from the current appStore-based architecture to the assistant-ui ecosystem. The migration will preserve essential functionality while leveraging assistant-ui's thread and runtime management capabilities.

## Phase 1: Create New State Management for UI & Settings

### 1.1 Create a minimal UI store (`uiStore.ts`) for:

- `showSettings` state and toggle action
- `containerRef` and `containerBounds` management
- View visibility state (`isViewHidden`)

### 1.2 Update affected components:

- `App.tsx` - Use new uiStore for settings toggle
- `settings-button.tsx` - Use new uiStore
- `use-view-visibility.ts` - Use new uiStore

### 1.3 Remove initialization-related components:

- Remove initialization state from appStore

## Phase 2: Integrate Browser Context with Assistant-UI

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

## Phase 3: Remove Task/Page Management Infrastructure

### 3.1 Backend removal:

- Remove `electron/main/services/StateManager.ts`
- Remove `electron/main/bridge/TaskBridge.ts`
- Remove task/page related methods from `electron/main/bridge/ViewBridge.ts`
- Clean up `electron/main/bridge/StateBridge.ts` to remove task synchronization

### 3.2 Frontend removal:

- Remove entire `src/store` directory (appStore and all related files)
- Remove task-related IPC handlers
- Remove `TaskRuntimeProvider` if no longer needed

### 3.3 Simplify WebViewService:

- Keep only single webview management
- Remove task/page ID resolution
- Simplify to manage one browser view at a time

## Phase 4: Refactor Browser Integration

### 4.1 Single browser view model:

- One active browser view managed by WebViewService (no view IDs needed)
- Navigation controlled through assistant messages
- State tracked in assistant conversation history
- Direct WebView management without ID tracking

### 4.2 Update IPC channels:

- **Keep**: `app:navigate`, `app:goBack`, `app:goForward`, `app:reload`
- **Keep**: `app:setViewBounds`, `app:setViewVisibility`
- **Remove**: All task/page related channels

### 4.3 Update UI components:

- Remove URL display from AppHeader (or get it directly from WebViewService)
- Update any remaining references to use new state management

## Phase 5: Testing & Cleanup

### 5.1 Test all functionality:

- Browser navigation through chat
- Settings panel toggle
- View visibility management

### 5.2 Final cleanup:

- Remove any dead code
- Update TypeScript types
- Clean up unused imports
- Update documentation

## Benefits of This Migration

1. **Simplified Architecture**: Single conversation thread manages browser state
2. **Better Context**: Browser actions are part of conversation history
3. **Extensibility**: Easy to add new browser tools and capabilities
4. **Cleaner Code**: Remove complex task/page/view state management
5. **Native Integration**: Leverage assistant-ui's built-in features

## Risks & Mitigations

### Risk 1: Loss of multi-task capability

**Mitigation**: Can be re-added later using assistant-ui's thread management

### Risk 2: Breaking existing functionality

**Mitigation**: Incremental migration with testing at each phase

### Risk 3: Performance impact

**Mitigation**: Assistant-ui is optimized for chat applications

## Implementation Order

1. Start with Phase 1 (new stores) - Low risk, doesn't break existing code
2. Implement Phase 2 (browser integration) - Adds new capabilities
3. Test thoroughly
4. Execute Phase 3 & 4 (removal) - Higher risk but well-tested
5. Complete with Phase 5 (cleanup)

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

This migration will result in a cleaner, more maintainable codebase that fully leverages the assistant-ui ecosystem while preserving all essential browser automation capabilities.
