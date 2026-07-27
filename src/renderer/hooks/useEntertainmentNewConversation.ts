import { useCallback, useState } from "react";
import { useAui, useAuiState } from "@assistant-ui/react";
import { useChaptersStore } from "@/stores/chaptersStore";

/**
 * The shared "stop the current entertainment thread and start a fresh wizard"
 * action. Used by BOTH the sidebar's New Conversation button (in entertainment
 * mode) and the reader's Stop button — so they always behave identically.
 *
 * Only invoked from the reader (a thread with an open chapter). The sidebar
 * button is disabled while the wizard is showing, so there is no wizard branch
 * here. The action: stop the in-flight work (the backend sets the durable
 * `stopStatus` flag + aborts the running agent) and PERSIST the thread in that
 * stopped state — identical to the reader footer's Stop button. The thread
 * stays in the sidebar; reopening it shows the stopped state and resumes only
 * when the user presses Process/Redo. Then reset the chapter cache and switch
 * to a fresh wizard thread.
 *
 * Returns `{ abandon, stopping }` where `stopping` is true while the
 * stop+switch sequence is in flight (backs the reader Stop button's spinner).
 */
export function useEntertainmentNewConversation(): {
  abandon: () => Promise<void>;
  stopping: boolean;
} {
  const mainThreadId = useAuiState((s) => s.threads.mainThreadId);
  const aui = useAui();
  const [stopping, setStopping] = useState(false);

  const abandon = useCallback(async () => {
    if (!mainThreadId || stopping) return;
    setStopping(true);
    const { stopAgents, reset } = useChaptersStore.getState();
    try {
      // Stop in-flight work (sets the durable stopStatus flag). Best-effort —
      // if the backend is unreachable we still switch away so the user isn't stuck.
      try {
        await stopAgents(mainThreadId);
      } catch {
        /* backend unreachable */
      }
      // The thread stays persisted in its stopped state (same as the reader
      // footer's Stop button) — no delete. Reset the chapter cache and switch
      // to a fresh wizard thread.
      reset();
      await aui.threads().switchToNewThread();
    } finally {
      setStopping(false);
    }
  }, [mainThreadId, aui, stopping]);

  return { abandon, stopping };
}
