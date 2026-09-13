import type { Rectangle } from "electron";

/**
 * Convert a split-view container rect reported by the renderer (CSS pixels,
 * from getBoundingClientRect) into the DIP rectangle that
 * WebContentsView.setBounds() expects. At zoom factor z one CSS px renders as
 * z DIPs, so every field scales by z; at the default zoom (1) the two spaces
 * coincide, which is why misalignment only appears once the user zooms.
 *
 * Must be applied with the zoom factor current at apply time, not at the
 * moment the rect was received — the user can zoom between posts.
 */
export function cssRectToDip(rect: Rectangle, zoomFactor: number): Rectangle {
  return {
    x: rect.x * zoomFactor,
    y: rect.y * zoomFactor,
    width: rect.width * zoomFactor,
    height: rect.height * zoomFactor,
  };
}
