import { useEffect } from 'react';
import { cleanupResizeObserver } from '@/store/appStore';

/**
 * Hook that ensures proper cleanup of the ResizeObserver when component unmounts.
 * This should be used in the root component that sets up the container ref.
 */
export function useResizeObserverCleanup() {
  useEffect(() => {
    // Cleanup function runs when component unmounts
    return () => {
      cleanupResizeObserver();
    };
  }, []);
}