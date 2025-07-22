# State Management Bug Report

## Files Analyzed

- `electron/main/services/StateManager.ts`
- `electron/main/bridge/StateBridge.ts`
- `src/store/appStore.ts`

## Potential Bugs Found

### 1. Race Condition in Task Creation with Pages

**Location**: StateManager.ts:86-89
**Issue**: When creating a task with an initial URL, the page is added asynchronously but the task is returned immediately. This could cause issues if the renderer tries to access the page before it's created.
**Fix**: Make `createTask` async and await the `addPage` call, or ensure proper state synchronization after page creation.

### 2. Circular Dependency Risk

**Location**: StateManager.ts:36-44
**Issue**: The `setWebViewService` method creates a circular dependency between StateManager and WebViewService. If not carefully managed during initialization, this could lead to undefined service references.
**Fix**: Consider using dependency injection or a service locator pattern to manage these dependencies more cleanly.

### 4. Map Serialization Issues

**Location**: appStore.ts:264-291
**Issue**: The state synchronization converts Maps to plain objects and back. The `restoreTaskPages` function only handles the `pages` Map within tasks, but tasks themselves are stored in a Map. This inconsistent handling could lead to type mismatches.
**Fix**: Ensure consistent Map/object conversion throughout the synchronization process.

### 5. Async Operation Without Error Boundaries

**Location**: appStore.ts:515-521
**Issue**: The initial state fetch happens outside any error boundary and only logs errors. If this fails, the app starts with no state and no user feedback.
**Fix**: Implement a proper error state or retry mechanism for initial state loading.

### 6. View Visibility State Inconsistency

**Location**: appStore.ts:217-242
**Issue**: The `setViewVisibility` uses a Set to track multiple reasons for hiding, but there's no validation that reasons are properly cleaned up. A component could add a reason and never remove it, permanently hiding the view.
**Fix**: Implement a cleanup mechanism or timeout for visibility reasons.

### 7. ResizeObserver Cleanup Timing

**Location**: appStore.ts:526-543
**Issue**: The ResizeObserver cleanup happens when containerRef changes, but not when the component unmounts. This could cause errors if the observer fires after unmount.
**Fix**: Add cleanup on store destruction or component unmount.

### 8. Missing Validation in Page Updates

**Location**: StateManager.ts:178-186
**Issue**: The `updatePage` method applies partial updates without validating the updates. Malformed data could corrupt the page state.
**Fix**: Add validation for the update fields before applying them.

### 9. Potential Null Reference in Container Bounds

**Location**: appStore.ts:259-274
**Issue**: The `updateContainerBounds` method sets bounds to null if no container exists, but other parts of the code don't always check for null before using these bounds.
**Fix**: Add null checks wherever containerBounds is accessed, or provide default bounds.

### 10. State Sync Race Condition

**Location**: appStore.ts:506-512
**Issue**: The IPC listeners for state sync are set up after the store is created. If state changes arrive before listeners are attached, they'll be missed.
**Fix**: Set up listeners before creating the store or queue early messages.

## Summary

These bugs range from minor issues to potentially significant problems that could affect application stability and user experience. Priority should be given to:

1. Memory leak in StateBridge (Bug #3)
2. State sync race condition (Bug #10)
3. Initial state loading error handling (Bug #5)
