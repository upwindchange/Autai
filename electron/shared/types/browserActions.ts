export interface ActionResult {
  success: boolean;
  data?: unknown;
  error?: string;
  extractedContent?: string;
  screenshot?: Buffer;
}

export interface InteractableElement {
  id: number; // 1-based index
  type:
    | "link"
    | "button"
    | "input"
    | "select"
    | "textarea"
    | "scrollable"
    | "frame"
    | "details"
    | "interactive";
  text: string; // From getLinkText()
  href?: string;
  rect: {
    top: number;
    left: number;
    width: number;
    height: number;
  };
  reason?: string; // Why element is interactive (e.g., "Scroll", "Frame", "Open/Close")
  xpath?: string; // XPath for locating element
  selector?: string; // Simple selector reference
}

export interface ScreenshotOptions {
  rect?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  fullPage?: boolean;
}

export interface BrowserActionOptions {
  timeout?: number;
  waitForNavigation?: boolean;
  screenshot?: boolean;
}