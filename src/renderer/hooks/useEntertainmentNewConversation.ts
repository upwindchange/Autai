import { useCallback, useState } from "react";
import { useEntertainmentThreadsStore } from "@/stores/entertainmentThreadsStore";

/**
 * The shared "abandon the current entertainment thread and start a fresh
 * wizard" action. Used by BOTH the sidebar's New Conversation button (in
 * entertainment mode) and the reader's Stop button — so they always behave
 * identically.
 *
 * Only invoked from the reader (a thread with an open chapter); the sidebar
 * button is disabled while the wizard is showing. `startNewWizard` resets the
 * chapter cache and creates a fresh backend entertainment thread for the new
 * wizard. The abandoned thread stays in the sidebar. `stopping` is true while
 * the backend thread creation is in flight (backs the reader Stop button's
 * spinner).
 */
export function useEntertainmentNewConversation(): {
  abandon: () => Promise<void>;
  stopping: boolean;
} {
  const [stopping, setStopping] = useState(false);

  const abandon = useCallback(async () => {
    if (stopping) return;
    setStopping(true);
    try {
      await useEntertainmentThreadsStore.getState().startNewWizard();
    } finally {
      setStopping(false);
    }
  }, [stopping]);

  return { abandon, stopping };
}
