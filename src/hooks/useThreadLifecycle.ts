import { useEffect, useRef } from "react";
import { useAssistantRuntime } from "@assistant-ui/react";
import { createLogger } from "@/lib/logger";

const logger = createLogger('useThreadLifecycle');

/**
 * Hook that bridges assistant-ui runtime thread events to backend IPC.
 * Handles thread lifecycle events: creation, switching, and deletion.
 */
export function useThreadLifecycle() {
  const runtime = useAssistantRuntime();
  const previousThreadIdRef = useRef<string | null>(null);

  useEffect(() => {
    logger.debug("hook triggered");
    // Check if runtime has thread support
    if (!runtime.threads?.mainItem) {
      logger.warn("runtime does not support thread management");
      return;
    }

    try {
      // Initial thread setup - use mainItem to get current thread ID
      const currentThreadId = runtime.threads.mainItem.getState().id;
      logger.debug("initial thread setup", { currentThreadId });

      if (currentThreadId) {
        logger.debug("sending threadview:created ipc", { threadId: currentThreadId });
        window.ipcRenderer.send("threadview:created", currentThreadId);
        previousThreadIdRef.current = currentThreadId;
      }

      // Subscribe to thread changes via mainItem
      const unsubscribe = runtime.threads.mainItem.subscribe(() => {
        const currentThreadId = runtime.threads.mainItem.getState().id;
        const previousThreadId = previousThreadIdRef.current;

        logger.debug("thread change detected", { previousThreadId, currentThreadId });

        if (currentThreadId !== previousThreadId) {
          if (currentThreadId) {
            // Check if this is a new thread creation
            const threadsState = runtime.threads.getState();
            logger.debug("checking if thread is new", { currentThreadId, newThread: threadsState.newThread });

            if (threadsState.newThread === currentThreadId) {
              logger.debug("detected new thread, sending threadview:created ipc", { threadId: currentThreadId });
              window.ipcRenderer.send("threadview:created", currentThreadId);
            }

            // Thread switched
            logger.debug("sending threadview:switched ipc", { threadId: currentThreadId });
            window.ipcRenderer.send("threadview:switched", currentThreadId);
          }

          previousThreadIdRef.current = currentThreadId;
        }
      });

      return () => {
        logger.debug("cleaning up subscription", { lastThreadId: previousThreadIdRef.current });
        unsubscribe();
        // Cleanup: notify if thread is being destroyed
        if (previousThreadIdRef.current) {
          logger.debug("sending threadview:deleted ipc", { threadId: previousThreadIdRef.current });
          window.ipcRenderer.send(
            "threadview:deleted",
            previousThreadIdRef.current
          );
        }
      };
    } catch (error) {
      logger.error("error setting up thread lifecycle", error);
      return;
    }
  }, [runtime]);
}
