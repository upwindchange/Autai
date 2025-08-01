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
    // Initial thread setup - use mainItem to get current thread ID
    const currentThreadId = runtime.threads.mainItem.getState().id;
    if (currentThreadId) {
      // TODO: Implement when new BrowserViewService is ready
      // window.ipcRenderer.invoke('thread:created', currentThreadId);
      console.log('useThreadLifecycle placeholder - thread created:', currentThreadId);
      previousThreadIdRef.current = currentThreadId;
    }
    
    // Subscribe to thread changes via mainItem
    const unsubscribe = runtime.threads.mainItem.subscribe(() => {
      const currentThreadId = runtime.threads.mainItem.getState().id;
      const previousThreadId = previousThreadIdRef.current;
      
      if (currentThreadId !== previousThreadId) {
        if (currentThreadId) {
          // Thread switched
          // TODO: Implement when new BrowserViewService is ready
          // window.ipcRenderer.invoke('thread:switched', currentThreadId);
          console.log('useThreadLifecycle placeholder - thread switched:', currentThreadId);
          
          // Check if this is a new thread creation
          const threadsState = runtime.threads.getState();
          if (threadsState.newThread === currentThreadId) {
            // TODO: Implement when new BrowserViewService is ready
            // window.ipcRenderer.invoke('thread:created', currentThreadId);
            console.log('useThreadLifecycle placeholder - new thread created:', currentThreadId);
          }
        }
        
        previousThreadIdRef.current = currentThreadId;
      }
    });
    
    return () => {
      unsubscribe();
      // Cleanup: notify if thread is being destroyed
      if (previousThreadIdRef.current) {
        // TODO: Implement when new BrowserViewService is ready
        // window.ipcRenderer.invoke('thread:deleted', previousThreadIdRef.current);
        console.log('useThreadLifecycle placeholder - thread deleted:', previousThreadIdRef.current);
      }
    };
  }, [runtime]);
}