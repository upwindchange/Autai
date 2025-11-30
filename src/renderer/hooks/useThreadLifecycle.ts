import { useEffect, useRef } from "react";
import { useAssistantEvent } from "@assistant-ui/react";
import log from "electron-log/renderer";

const logger = log.scope("useThreadLifecycle");

/**
 * Hook that bridges assistant-ui v0.12 thread events to backend IPC.
 * Handles thread lifecycle events: creation, switching, and deletion.
 */
export function useThreadLifecycle() {
  const previousThreadIdRef = useRef<string | null>(null);

  // Handle thread switch events
  useAssistantEvent("thread-list-item.switched-to", (event) => {
    logger.debug("thread switch event", { threadId: event.threadId });

    if (event.threadId && event.threadId !== previousThreadIdRef.current) {
      logger.debug("sending threadview:switched ipc", {
        threadId: event.threadId,
      });
      window.ipcRenderer.send("threadview:switched", event.threadId);
      previousThreadIdRef.current = event.threadId;
    }
  });

  // Handle thread initialization
  useAssistantEvent("thread.initialize", (event) => {
    logger.debug("thread initialize event", { threadId: event.threadId });

    if (event.threadId) {
      logger.debug("sending threadview:created ipc", {
        threadId: event.threadId,
      });
      window.ipcRenderer.send("threadview:created", event.threadId);
      previousThreadIdRef.current = event.threadId;
    }
  });

  // Handle thread cleanup (when component unmounts)
  useEffect(() => {
    return () => {
      if (previousThreadIdRef.current) {
        logger.debug("cleanup: sending threadview:deleted ipc", {
          threadId: previousThreadIdRef.current,
        });
        window.ipcRenderer.send(
          "threadview:deleted",
          previousThreadIdRef.current
        );
      }
    };
  }, []);
}
