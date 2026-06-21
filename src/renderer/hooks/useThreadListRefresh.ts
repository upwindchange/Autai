import { useAui, type AssistantRuntime } from "@assistant-ui/react";
import { useTagStore } from "@/stores/tagStore";

/**
 * React hook for use inside AssistantRuntimeProvider.
 * Returns a stable `refresh` callback that refreshes thread list data.
 *
 * Reloads the assistant-ui thread list cache via its public `reload()` (triggers
 * adapter.list() which calls setThreadTags() to update threads/threadTags in
 * tagStore), then refreshes tag definitions independently. If the active thread
 * was deleted, switches to a new thread.
 */
export function useThreadListRefresh(): () => Promise<void> {
  const aui = useAui();

  return async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const runtime = (aui.threads() as any).__internal_getAssistantRuntime?.() as
      | AssistantRuntime
      | undefined;
    if (!runtime) return;

    const previousMainThreadId = runtime.threads.getState().mainThreadId;

    // Reload the thread list cache via the public API. `reload()` is
    // generation-guarded, so a burst of refreshes (e.g. several SSE
    // listChanged events) won't let a stale response overwrite a fresh one.
    // Triggers adapter.list(), which also updates tagStore via setThreadTags().
    await runtime.threads.reload();

    // Refresh tags independently (metadata update may have added/renamed tags)
    await useTagStore.getState().fetchTags();

    // If the active thread was deleted, switch to new thread
    const newState = runtime.threads.getState();
    const allThreadIds = [...newState.threadIds, ...newState.archivedThreadIds];
    if (previousMainThreadId && !allThreadIds.includes(previousMainThreadId)) {
      await runtime.threads.switchToNewThread();
    }
  };
}
