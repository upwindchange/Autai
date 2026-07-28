import { useCallback, useState } from "react";
import { useAui, useAuiState } from "@assistant-ui/react";
import { useChaptersStore } from "@/stores/chaptersStore";

/**
 * The shared "abandon the current entertainment thread and start a fresh
 * wizard" action. Used by BOTH the sidebar's New Conversation button (in
 * entertainment mode) and the reader's Stop button — so they always behave
 * identically.
 *
 * Only invoked from the reader (a thread with an open chapter). The sidebar
 * button is disabled while the wizard is showing, so there is no wizard branch
 * here. The action resets the chapter cache and switches to a fresh wizard
 * thread. The abandoned thread stays in the sidebar.
 *
 * Returns `{ abandon, stopping }` where `stopping` is true while the switch
 * is in flight (backs the reader Stop button's spinner).
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
    const { reset } = useChaptersStore.getState();
    try {
      // Reset the chapter cache and switch to a fresh wizard thread.
      reset();
      await aui.threads().switchToNewThread();
    } finally {
      setStopping(false);
    }
  }, [mainThreadId, aui, stopping]);

  return { abandon, stopping };
}
