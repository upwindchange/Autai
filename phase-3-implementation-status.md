# Phase 3 Implementation Status

## Completed Implementation Details

### 1. Type Definitions and Interfaces

#### Created Files:

- `electron/shared/types/auiThread.ts` - Core type definitions
- `electron/shared/types/services/auiThread.ts` - Service interfaces

#### Key Types:

- **AuiView**: Represents a browser view with `id`, `threadId`, `url`, `title`, `favicon`
- **AuiViewMetadata**: Tracks view display state with `bounds` and `isVisible`
- **AuiThreadViewState**: Maps threads to their views and active view
- **Command Types**: `CreateAuiViewCommand`, `NavigateAuiViewCommand`, etc.
- **Event Types**: `AuiThreadEvent`, `AuiViewEvent` for lifecycle management
- **BrowserAction**: Unified interface for browser automation (navigate, click, type, etc.)

### 2. Backend Services Implementation

#### AuiThreadViewManager (`electron/main/services/AuiThreadViewManager.ts`)

- **Purpose**: Manages thread-view relationships
- **Key Features**:
  - Tracks which views belong to which threads
  - Handles thread lifecycle (created, deleted, switched)
  - Maintains active thread state
  - Event emission for thread/view changes
  - Clean bidirectional mappings (thread→views, view→thread)

#### BrowserViewManager (`electron/main/services/BrowserViewManager.ts`)

- **Purpose**: Manages WebContentsView lifecycle
- **Key Features**:
  - Creates/destroys WebContentsView instances
  - Handles navigation, script execution, screenshots
  - Implements all BrowserAction types
  - Auto-injects helper scripts (hintDetector, buildDomTree)
  - Comprehensive event handling (navigation, crashes, console)
  - Clean resource cleanup on destroy

#### ViewOrchestrator (`electron/main/services/ViewOrchestrator.ts`)

- **Purpose**: Coordinates between managers and provides unified API
- **Key Features**:
  - Creates views for threads with proper registration
  - Manages view activation and visibility
  - Handles bounds updates and metadata tracking
  - Thread switching logic (shows/hides appropriate views)
  - Single active view enforcement

### 3. IPC Bridge Implementation

#### AuiThreadBridge (`electron/main/bridge/AuiThreadBridge.ts`)

- **IPC Channels Implemented**:
  - Thread lifecycle: `auiThread:created`, `auiThread:switched`, `auiThread:deleted`
  - View operations: `auiView:create`, `auiView:navigate`, `auiView:execute`, `auiView:close`
  - View state: `auiView:setBounds`, `auiView:setVisibility`, `auiView:setActive`
  - Query operations: `auiThread:getViews`, `auiThread:getActiveView`, `auiThread:getState`
- **Event Forwarding**: Automatically forwards thread/view events to renderer

### 4. Frontend Type Updates

#### Updated `src/vite-env.d.ts`

- Added all new AuiThread types to imports
- Defined IPC channel types for:
  - All thread operations
  - All view operations
  - Event listeners for `auiThread:event` and `auiView:event`
  - Proper TypeScript typing for all channels

## Architecture Decisions

1. **No Pages/Tabs Concept**: Views are just browser instances associated with threads
2. **Thread-First Design**: All operations start from thread context
3. **Interface-Driven**: All services implement interfaces for testability
4. **Event-Driven**: Thread lifecycle drives view lifecycle automatically
5. **Clean Separation**: Each service has single responsibility
6. **No Timestamps**: Removed `createdAt` as requested
7. **Type Safety**: Comprehensive Zod schemas for validation

## Remaining Steps (Brief)

### 1. Integrate with Assistant-UI Runtime

- Hook into thread lifecycle events from assistant-ui
- DO NOT create view when thread created, view creation will be handled by backend main process using function call tools by agents. This will be implemented later.
- containerref visible -> set active view for current active task visible.
- containerref unmmounted -> set active view for current active task invisible.

Remember:

- Clean up views when thread deleted
- True frontend functionality should be simply the above features.
- WebContentView are operated in backend main process.
- The front end is only responsible to send ipc signals to backend bridge to operate views. Nothing more fancy than this.
- Double Check if the implemented AuiThreadBridge, ViewOrchestrator, BrowserViewManager, AuiThreadViewManager is capable to realize the above functionalities, if features missing, what is missing, and your plan to compliment the feature. Do not do implementation, let me know your investigation result first.

### 2. Test New Architecture

- Investigate how difficult it is to intercept user's sent input from composer (maybe composerruntime), and detect "debug:<commands>". If there is debug command, do not send it to agent, invoke ipc function call.

## Migration Strategy Notes

- New services run parallel to old ones initially
- Make breaking changes aggresively on new services
- NO Gradual cutover approach
- Keep old code in `_legacy` folder for reference
