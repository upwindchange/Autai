import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from "react";
import { LocalHint } from "../lib/link-hints";

interface LinkHintsWrapperProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
}

export interface LinkHintsWrapperHandle {
  getHints: () => LocalHint[];
  clickHint: (index: number) => void;
  focusHint: (index: number) => void;
  hoverHint: (index: number) => void;
}

export const LinkHintsWrapper = forwardRef<LinkHintsWrapperHandle, LinkHintsWrapperProps>(
  ({ containerRef }, ref) => {
    const [hints, setHints] = useState<LocalHint[]>([]);

    // Detect interactable elements
    useEffect(() => {
      if (!containerRef.current) return;

      const detectHints = () => {
        const elements = containerRef.current?.querySelectorAll('*') || [];
        const localHints: LocalHint[] = [];
        
        elements.forEach(element => {
          // Simplified detection logic - will be replaced with Vimium's implementation
          if (element instanceof HTMLAnchorElement ||
              element instanceof HTMLButtonElement ||
              element instanceof HTMLInputElement) {
            const rect = element.getBoundingClientRect();
            localHints.push(new LocalHint({
              element,
              rect: {
                top: rect.top,
                left: rect.left,
                width: rect.width,
                height: rect.height
              }
            }));
          }
        });
        
        setHints(localHints);
      };

      // Initial detection
      detectHints();
      
      // Set up MutationObserver to re-detect on DOM changes
      const observer = new MutationObserver(detectHints);
      observer.observe(containerRef.current, {
        childList: true,
        subtree: true,
        attributes: true,
      });
      
      return () => observer.disconnect();
    }, []);

    // Handle hint interactions
    const handleHintClick = (hint: LocalHint) => {
      if (hint.element instanceof HTMLAnchorElement) {
        hint.element.click();
      } else if (hint.element instanceof HTMLInputElement) {
        hint.element.focus();
      } else if (hint.element instanceof HTMLButtonElement) {
        hint.element.click();
      }
    };

    const handleHintFocus = (hint: LocalHint) => {
      if (hint.element instanceof HTMLElement) {
        hint.element.focus();
      }
    };

    const handleHintHover = (hint: LocalHint) => {
      if (hint.element instanceof HTMLElement) {
        const mouseOverEvent = new MouseEvent('mouseover', {
          view: window,
          bubbles: true,
          cancelable: true
        });
        hint.element.dispatchEvent(mouseOverEvent);
      }
    };

    // Expose API and container element
    useImperativeHandle(ref, () => ({
      getHints: () => hints,
      clickHint: (index: number) => handleHintClick(hints[index]),
      focusHint: (index: number) => handleHintFocus(hints[index]),
      hoverHint: (index: number) => handleHintHover(hints[index]),
    }), [hints]);

    return (
      <div ref={containerRef} className="link-hints-wrapper relative flex flex-1 flex-col gap-4 p-4 overflow-y-auto h-full">
        {hints.map((hint, index) => (
          <div
            key={`hint-${index}`}
            className="absolute bg-yellow-300 bg-opacity-50 border border-yellow-500 rounded text-xs font-bold flex items-center justify-center cursor-pointer"
            style={{
              left: `${hint.rect.left}px`,
              top: `${hint.rect.top}px`,
              width: `${hint.rect.width}px`,
              height: `${hint.rect.height}px`,
            }}
            onClick={() => handleHintClick(hint)}
          >
            {index + 1}
          </div>
        ))}
      </div>
    );
  }
);
