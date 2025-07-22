import { useCallback } from 'react';
import { useAppStore } from '@/store/appStore';

/**
 * Hook for managing web view visibility with proper timing for animations.
 * This hook provides a consistent way to hide/show web views across different components.
 */
export function useViewVisibility() {
  const { setViewVisibility, activeViewId, containerRef, isViewHidden } = useAppStore();

  /**
   * Hide the active web view
   */
  const hideView = useCallback(() => {
    if (!activeViewId || !containerRef?.current) {
      return;
    }

    // Use the store's setViewVisibility
    setViewVisibility(true);
  }, [activeViewId, containerRef, setViewVisibility]);

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
        setViewVisibility(false);
      }, delay);
    } else {
      // Show immediately
      setViewVisibility(false);
    }
  }, [activeViewId, containerRef, setViewVisibility]);

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
    hasActiveView: !!activeViewId && !!containerRef?.current
  };
}