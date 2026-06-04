import { useAui, type AssistantRuntime } from "@assistant-ui/react";
import { useTagStore } from "@/stores/tagStore";

/**
 * React hook for use inside AssistantRuntimeProvider.
 * Returns a stable `refresh` callback that refreshes thread list data.
 *
 * Invalidates the assistant-ui runtime thread list cache (triggers adapter.list()
 * which calls setThreadTags() to update threads/threadTags in tagStore), then
 * refreshes tag definitions independently. If the active thread was deleted,
 * switches to a new thread.
 */
export function useThreadListRefresh(): () => Promise<void> {
  const aui = useAui();

  return async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const runtime = (aui.threads() as any).__internal_getAssistantRuntime?.() as
      | AssistantRuntime
      | undefined;
    if (!runtime) return;

    const state = runtime.threads.getState();
    const previousMainThreadId = state.mainThreadId;

    // Invalidate runtime cache (triggers adapter.list() which also updates tagStore)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const core = (runtime as any)._core;
    if (core?.threads) {
      core.threads._loadThreadsPromise = undefined;
      await core.threads.getLoadThreadsPromise();
    }

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
