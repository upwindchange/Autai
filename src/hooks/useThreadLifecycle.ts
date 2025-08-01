import { useEffect, useRef } from 'react';
import { useAssistantRuntime } from '@assistant-ui/react';

/**
 * Hook that bridges assistant-ui runtime thread events to backend IPC.
 * Handles thread lifecycle events: creation, switching, and deletion.
 */
export function useThreadLifecycle() {
  const runtime = useAssistantRuntime();
  const previousThreadIdRef = useRef<string | null>(null);
  
  useEffect(() => {
    // Check if runtime has thread support
    if (!runtime.threads?.mainItem) {
      console.warn('[useThreadLifecycle] Runtime does not support thread management');
      return;
    }
    
    try {
      // Initial thread setup - use mainItem to get current thread ID
      const currentThreadId = runtime.threads.mainItem.getState().id;
      if (currentThreadId) {
        window.ipcRenderer.invoke('thread:created', currentThreadId);
        previousThreadIdRef.current = currentThreadId;
      }
      
      // Subscribe to thread changes via mainItem
      const unsubscribe = runtime.threads.mainItem.subscribe(() => {
        const currentThreadId = runtime.threads.mainItem.getState().id;
        const previousThreadId = previousThreadIdRef.current;
        
        if (currentThreadId !== previousThreadId) {
          if (currentThreadId) {
            // Thread switched
            window.ipcRenderer.invoke('thread:switched', currentThreadId);
            
            // Check if this is a new thread creation
            const threadsState = runtime.threads.getState();
            if (threadsState.newThread === currentThreadId) {
              window.ipcRenderer.invoke('thread:created', currentThreadId);
            }
          }
          
          previousThreadIdRef.current = currentThreadId;
        }
      });
      
      return () => {
        unsubscribe();
        // Cleanup: notify if thread is being destroyed
        if (previousThreadIdRef.current) {
          window.ipcRenderer.invoke('thread:deleted', previousThreadIdRef.current);
        }
      };
    } catch (error) {
      console.warn('[useThreadLifecycle] Error setting up thread lifecycle:', error);
      return;
    }
    
    return () => {
      unsubscribe();
      // Cleanup: notify if thread is being destroyed
      if (previousThreadIdRef.current) {
        window.ipcRenderer.invoke('thread:deleted', previousThreadIdRef.current);
      }
    };
  }, [runtime]);
}