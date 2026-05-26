import { useEffect } from "react";
import { useAuiState } from "@assistant-ui/react";
import { useUiStore } from "@/stores/uiStore";
import log from "electron-log/renderer";

const logger = log.scope("useSessionLifecycle");

/**
 * Hook that activates the appropriate backend session based on UI state.
 * Derives the active session from showSettings and mainTabId, and sends
 * sessiontab:activate to ensure the session exists and is made active.
 */
export function useSessionLifecycle() {
  const showSettings = useUiStore((s) => s.showSettings);
  const mainTabId = useAuiState(({ threads }) => threads.mainThreadId);
  const activeSessionId = showSettings ? "settings-session" : mainTabId;

  useEffect(() => {
    if (activeSessionId) {
      logger.debug("activating session", { activeSessionId });
      window.ipcRenderer.send("sessiontab:activate", activeSessionId);
    }
  }, [activeSessionId]);
}
