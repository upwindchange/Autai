import { useCallback } from 'react';
import { useAppStore } from '@/store/appStore';

/**
 * Hook for managing web view visibility with proper timing for animations.
 * This hook provides a consistent way to hide/show web views across different components.
 * 
 * @param reason - A unique identifier for the component using this hook (e.g., 'sidebar', 'settings')
 */
export function useViewVisibility(reason: string) {
  const { setViewVisibility, activeViewId, containerRef, isViewHidden, viewHiddenReasons } = useAppStore();

  /**
   * Hide the active web view
   */
  const hideView = useCallback(() => {
    if (!activeViewId || !containerRef?.current) {
      return;
    }

    // Use the store's setViewVisibility with the component's reason
    setViewVisibility(true, reason);
  }, [activeViewId, containerRef, setViewVisibility, reason]);

  /**
   * Show the active web view
   * @param delay - Optional delay in milliseconds before showing (default: 100ms for animations)
   */
  const showView = useCallback((delay: number = 100) => {
    if (!activeViewId || !containerRef?.current) {
      return;
    }

    if (delay > 0) {
      // Delay showing to allow for animations
      setTimeout(() => {
        setViewVisibility(false, reason);
      }, delay);
    } else {
      // Show immediately
      setViewVisibility(false, reason);
    }
  }, [activeViewId, containerRef, setViewVisibility, reason]);

  /**
   * Toggle view visibility
   * @param visible - If true, show the view. If false, hide the view.
   * @param options - Options for timing
   */
  const setVisibility = useCallback((visible: boolean, options?: { delay?: number }) => {
    if (visible) {
      showView(options?.delay);
    } else {
      hideView();
    }
  }, [hideView, showView]);

  return {
    hideView,
    showView,
    setVisibility,
    isViewHidden,
    hasActiveView: !!activeViewId && !!containerRef?.current,
    isHiddenByMe: viewHiddenReasons.has(reason)
  };
}