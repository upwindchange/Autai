import { useAui, type AssistantRuntime } from "@assistant-ui/react";
import { useTagStore } from "@/stores/tagStore";

/**
 * Invalidate the assistant-ui runtime thread list cache and trigger a fresh load.
 *
 * The runtime caches the thread list after the first successful `list()` call via
 * `_loadThreadsPromise` on `RemoteThreadListThreadListRuntimeCore`. There is no
 * public refresh API, so we access the internal chain:
 *
 *   AssistantRuntimeImpl._core          => RemoteThreadListRuntimeCore
 *   RemoteThreadListRuntimeCore.threads => RemoteThreadListThreadListRuntimeCore
 *   ._loadThreadsPromise = undefined    => invalidates cache
 *   .getLoadThreadsPromise()            => triggers fresh adapter.list()
 *
 * When adapter.list() runs (via backendThreadListAdapter), it also calls
 * useTagStore.setThreadTags(), so both the runtime and tagStore are refreshed.
 */
async function invalidateRuntimeCache(
  runtime: AssistantRuntime,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const runtimeImpl = runtime as any;
  const core = runtimeImpl._core;
  if (!core?.threads) return;

  const threadListCore = core.threads;
  threadListCore._loadThreadsPromise = undefined;
  await threadListCore.getLoadThreadsPromise();
}

/**
 * Refresh all thread data: runtime cache + tagStore threads + tag definitions.
 * If the currently active thread was deleted, switches to a new thread.
 */
export async function refreshThreadListData(
  runtime: AssistantRuntime,
): Promise<void> {
  const state = runtime.threads.getState();
  const previousMainThreadId = state.mainThreadId;

  // 1. Invalidate runtime cache (triggers adapter.list() which also updates tagStore)
  await invalidateRuntimeCache(runtime);

  // 2. Refresh tags independently (metadata update may have added/renamed tags)
  await useTagStore.getState().fetchTags();

  // 3. If the active thread was deleted, switch to new thread
  const newState = runtime.threads.getState();
  const allThreadIds = [...newState.threadIds, ...newState.archivedThreadIds];
  if (previousMainThreadId && !allThreadIds.includes(previousMainThreadId)) {
    await runtime.threads.switchToNewThread();
  }
}

/**
 * React hook for use inside AssistantRuntimeProvider.
 * Returns a stable `refresh` callback that refreshes thread list data.
 */
export function useThreadListRefresh(): () => Promise<void> {
  const aui = useAui();

  return async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const runtime = (aui.threads() as any).__internal_getAssistantRuntime?.();
    if (!runtime) return;
    await refreshThreadListData(runtime);
  };
}
