import { useEffect, useRef } from "react";
import { useAssistantRuntime } from "@assistant-ui/react";

/**
 * Hook that bridges assistant-ui runtime thread events to backend IPC.
 * Handles thread lifecycle events: creation, switching, and deletion.
 */
export function useThreadLifecycle() {
  const runtime = useAssistantRuntime();
  const previousThreadIdRef = useRef<string | null>(null);

  useEffect(() => {
    console.log("useThreadLifecycle: hook triggered");
    // Check if runtime has thread support
    if (!runtime.threads?.mainItem) {
      console.warn(
        "[useThreadLifecycle] Runtime does not support thread management"
      );
      return;
    }

    try {
      // Initial thread setup - use mainItem to get current thread ID
      const currentThreadId = runtime.threads.mainItem.getState().id;
      console.log(
        `useThreadLifecycle: Initial thread setup, currentThreadId=${currentThreadId}`
      );

      if (currentThreadId) {
        console.log(
          `useThreadLifecycle: Sending threadview:created IPC for thread ${currentThreadId}`
        );
        window.ipcRenderer.send("threadview:created", currentThreadId);
        previousThreadIdRef.current = currentThreadId;
      }

      // Subscribe to thread changes via mainItem
      const unsubscribe = runtime.threads.mainItem.subscribe(() => {
        const currentThreadId = runtime.threads.mainItem.getState().id;
        const previousThreadId = previousThreadIdRef.current;

        console.log(
          `useThreadLifecycle: Thread change detected - previous=${previousThreadId}, current=${currentThreadId}`
        );

        if (currentThreadId !== previousThreadId) {
          if (currentThreadId) {
            // Check if this is a new thread creation
            const threadsState = runtime.threads.getState();
            console.log(
              `useThreadLifecycle: Checking if thread ${currentThreadId} is new, newThread=${threadsState.newThread}`
            );

            if (threadsState.newThread === currentThreadId) {
              console.log(
                `useThreadLifecycle: Detected new thread ${currentThreadId}, sending threadview:created IPC`
              );
              window.ipcRenderer.send("threadview:created", currentThreadId);
            }

            // Thread switched
            console.log(
              `useThreadLifecycle: Sending threadview:switched IPC for thread ${currentThreadId}`
            );
            window.ipcRenderer.send("threadview:switched", currentThreadId);
          }

          previousThreadIdRef.current = currentThreadId;
        }
      });

      return () => {
        console.log(
          `useThreadLifecycle: Cleaning up subscription, last thread was ${previousThreadIdRef.current}`
        );
        unsubscribe();
        // Cleanup: notify if thread is being destroyed
        if (previousThreadIdRef.current) {
          console.log(
            `useThreadLifecycle: Sending threadview:deleted IPC for thread ${previousThreadIdRef.current}`
          );
          window.ipcRenderer.send(
            "threadview:deleted",
            previousThreadIdRef.current
          );
        }
      };
    } catch (error) {
      console.warn(
        "[useThreadLifecycle] Error setting up thread lifecycle:",
        error
      );
      return;
    }
  }, [runtime]);
}
