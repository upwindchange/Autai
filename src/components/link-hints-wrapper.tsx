import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from "react";

interface LinkHintsWrapperProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
}

export interface LinkHintsWrapperHandle {
  getHints: () => WebViewHint[];
  clickHint: (index: number) => void;
  focusHint: (index: number) => void;
  hoverHint: (index: number) => void;
}

interface WebViewHint {
  rect: {
    top: number;
    left: number;
    width: number;
    height: number;
    right?: number;
    bottom?: number;
  };
  linkText: string;
  tagName: string;
  href: string | null;
  reason?: string;
}

// Generate hint strings (A, B, C, ..., AA, AB, etc.)
const generateHintString = (index: number): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let result = '';
  let num = index - 1;
  
  while (num >= 0) {
    result = chars[num % 26] + result;
    num = Math.floor(num / 26) - 1;
  }
  
  return result || 'A';
};

export const LinkHintsWrapper = forwardRef<LinkHintsWrapperHandle, LinkHintsWrapperProps>(
  ({ containerRef }, ref) => {
    const [hints, setHints] = useState<WebViewHint[]>([]);
    const [showHints, setShowHints] = useState(true);
    const [activeViewKey, setActiveViewKey] = useState<string | null>(null);
    const hintsContainerRef = useRef<HTMLDivElement>(null);

    // Detect hints from the active WebContentsView
    const detectHints = async () => {
      if (!activeViewKey) {
        console.log("No active view key, skipping hint detection");
        return;
      }

      console.log(`Detecting hints for view: ${activeViewKey}`);
      try {
        const detectedHints = await window.ipcRenderer.invoke("hints:detect", activeViewKey);
        console.log(`Detected ${detectedHints.length} hints`);
        
        // Adjust hint positions relative to container
        if (containerRef.current) {
          const containerRect = containerRef.current.getBoundingClientRect();
          const adjustedHints = detectedHints.map((hint: WebViewHint) => ({
            ...hint,
            rect: {
              ...hint.rect,
              top: hint.rect.top + containerRect.top,
              left: hint.rect.left + containerRect.left,
            }
          }));
          setHints(adjustedHints);
          console.log(`Set ${adjustedHints.length} adjusted hints`);
        }
      } catch (error) {
        console.error("Error detecting hints:", error);
        setHints([]);
      }
    };

    // Listen for active view changes
    useEffect(() => {
      const handleViewChange = (_: any, viewKey: string) => {
        console.log(`Active view changed to: ${viewKey}`);
        setActiveViewKey(viewKey);
      };

      window.ipcRenderer.on("active-view-changed", handleViewChange);

      return () => {
        window.ipcRenderer.off("active-view-changed", handleViewChange);
      };
    }, []);

    // Show hints when active view changes
    useEffect(() => {
      if (activeViewKey) {
        // Wait a bit for the page to load before showing hints
        const timeout = setTimeout(async () => {
          try {
            await window.ipcRenderer.invoke("hints:show", activeViewKey);
            // Also get hint count for debug display
            const detectedHints = await window.ipcRenderer.invoke("hints:detect", activeViewKey);
            setHints(detectedHints);
          } catch (error) {
            console.error("Error showing hints:", error);
          }
        }, 1000);
        
        // Set up periodic hint refresh
        const interval = setInterval(async () => {
          try {
            await window.ipcRenderer.invoke("hints:show", activeViewKey);
            const detectedHints = await window.ipcRenderer.invoke("hints:detect", activeViewKey);
            setHints(detectedHints);
          } catch (error) {
            console.error("Error refreshing hints:", error);
          }
        }, 3000);
        
        return () => {
          clearTimeout(timeout);
          clearInterval(interval);
        };
      }
    }, [activeViewKey]);

    // Also detect on scroll and resize
    useEffect(() => {
      const handleScrollOrResize = () => {
        detectHints();
      };
      
      window.addEventListener('scroll', handleScrollOrResize, true);
      window.addEventListener('resize', handleScrollOrResize);
      
      return () => {
        window.removeEventListener('scroll', handleScrollOrResize, true);
        window.removeEventListener('resize', handleScrollOrResize);
      };
    }, [activeViewKey]);

    // Handle hint interactions
    const handleHintClick = async (hint: WebViewHint, index: number) => {
      if (!activeViewKey) return;
      
      try {
        await window.ipcRenderer.invoke(`hint:click:${activeViewKey}`, index);
      } catch (error) {
        console.error("Error clicking hint:", error);
      }
    };

    const handleHintFocus = (hint: WebViewHint, index: number) => {
      // Focus functionality can be implemented similarly
      console.log("Focus hint:", index);
    };

    const handleHintHover = (hint: WebViewHint, index: number) => {
      // Hover functionality can be implemented similarly
      console.log("Hover hint:", index);
    };

    // Expose API
    useImperativeHandle(ref, () => ({
      getHints: () => hints,
      clickHint: (index: number) => handleHintClick(hints[index], index),
      focusHint: (index: number) => handleHintFocus(hints[index], index),
      hoverHint: (index: number) => handleHintHover(hints[index], index),
    }), [hints, activeViewKey]);

    return (
      <>
        <div ref={containerRef} className="link-hints-wrapper relative flex flex-1 flex-col gap-4 p-4 overflow-y-auto h-full" />
        
        {/* Debug info */}
        <div className="fixed top-2 right-2 bg-black bg-opacity-50 text-white text-xs p-2 rounded z-[10000]">
          Active View: {activeViewKey || 'None'}<br/>
          Hints: {hints.length}<br/>
          Show: {showHints ? 'Yes' : 'No'}
        </div>
        
        {/* Hints are now rendered directly in the WebContentsView */}
      </>
    );
  }
);

LinkHintsWrapper.displayName = "LinkHintsWrapper";