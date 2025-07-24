import { useEffect } from 'react';
import { useAssistantRuntime } from '@assistant-ui/react';
import { useUiStore } from '@/stores/uiStore';

/**
 * Hook that syncs container mount/unmount state with view visibility.
 * When the container is mounted (split view active), the current thread's active view is made visible.
 * When unmounted, the view is hidden.
 * 
 * The backend handles view switching between threads via auiThread:switched events.
 */
export function useViewVisibility() {
  const { containerRef } = useUiStore();
  const runtime = useAssistantRuntime();
  
  useEffect(() => {
    const updateVisibility = async (isVisible: boolean) => {
      const threadId = runtime.threads.mainItem.getState().id;
      
      if (!threadId) return;
      
      // Get the active view for current thread
      const result = await window.ipcRenderer.invoke('auiThread:getActiveView', threadId);
      
      if (result.success && result.data) {
        const activeViewId = result.data;
        
        // Set visibility
        await window.ipcRenderer.invoke('auiView:setVisibility', {
          viewId: activeViewId,
          isVisible
        });
      }
    };
    
    // Set visibility based on current container state
    updateVisibility(!!containerRef);
    
    // Cleanup function - hide view when hook unmounts
    return () => {
      updateVisibility(false);
    };
  }, [containerRef, runtime.threads.mainItem]);
}