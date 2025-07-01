import { useEffect, useState, useRef, useCallback } from "react";

// Define Rect interface since it's not in utils
interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface HintData {
  id: string;
  label: string;
  rect: Rect;
  element: HTMLElement;
}

interface LinkHintsProps {
  viewKey: string | null;
  containerRef: React.RefObject<HTMLDivElement>;
}

const LinkHints = ({ viewKey, containerRef }: LinkHintsProps) => {
  const [hints, setHints] = useState<HintData[]>([]);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Detect clickable elements in the current view
  const detectClickableElements = useCallback(async () => {
    if (!viewKey || !containerRef.current) return;

    try {
      const elements = await window.ipcRenderer.invoke(
        "dom:getClickableElements",
        viewKey,
        containerRef.current.getBoundingClientRect()
      );

      const newHints = elements.map((el: HTMLElement, index: number) => {
        const rect = el.getBoundingClientRect();
        return {
          id: `hint-${index}`,
          label: index.toString(36).toUpperCase(), // Generate hint labels (1, 2, 3, ... A, B, C)
          rect: {
            top: rect.top + window.scrollY,
            left: rect.left + window.scrollX,
            width: rect.width,
            height: rect.height,
          },
          element: el,
        };
      });

      setHints(newHints);
    } catch (error) {
      console.error("Error detecting clickable elements:", error);
    }
  }, [viewKey, containerRef]);

  // Handle hint click
  const handleHintClick = useCallback(
    (hint: HintData) => {
      if (!viewKey) return;

      const centerX = hint.rect.left + hint.rect.width / 2;
      const centerY = hint.rect.top + hint.rect.height / 2;

      window.ipcRenderer.send("dom:clickElement", viewKey, {
        x: centerX,
        y: centerY,
      });

      setHints([]); // Clear hints after selection
    },
    [viewKey]
  );

  // Detect elements when viewKey changes
  useEffect(() => {
    if (viewKey) {
      detectClickableElements();
    } else {
      setHints([]);
    }
  }, [viewKey, detectClickableElements]);

  // Add scroll/resize listeners
  useEffect(() => {
    const handleScrollOrResize = () => {
      if (viewKey) detectClickableElements();
    };

    window.addEventListener("scroll", handleScrollOrResize);
    window.addEventListener("resize", handleScrollOrResize);

    return () => {
      window.removeEventListener("scroll", handleScrollOrResize);
      window.removeEventListener("resize", handleScrollOrResize);
    };
  }, [viewKey, detectClickableElements]);

  return (
    <div
      ref={overlayRef}
      className="link-hints-overlay"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        pointerEvents: "none",
        zIndex: 9999,
      }}
    >
      {hints.map((hint) => (
        <div
          key={hint.id}
          className="hint-marker"
          onClick={() => handleHintClick(hint)}
          style={{
            position: "absolute",
            top: `${hint.rect.top}px`,
            left: `${hint.rect.left}px`,
            width: `${hint.rect.width}px`,
            height: `${hint.rect.height}px`,
            backgroundColor: "rgba(255, 204, 0, 0.3)",
            border: "2px solid rgba(255, 153, 0, 0.7)",
            borderRadius: "3px",
            pointerEvents: "auto",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "14px",
            fontWeight: "bold",
            color: "black",
          }}
        >
          {hint.label}
        </div>
      ))}
    </div>
  );
};

export default LinkHints;
