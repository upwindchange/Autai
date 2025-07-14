// TypeScript implementation of hint detection for browser automation
// Based on Vimium-C and Vimium hint detection algorithms

// Import css-selector-generator for generating unique CSS selectors
// Note: This assumes getCssSelector is available globally when the script is injected
declare const getCssSelector: ((element: Element) => string) | undefined;

interface Rect {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

interface HintItem {
  rect: Rect;
  linkText: string;
  tagName: string;
  href: string | null;
  reason: string | null;
  xpath: string | null;
  selector: string | null;
  possibleFalsePositive?: boolean;
  secondClassCitizen?: boolean;
}

interface InteractableElement {
  id: number;
  type: string;
  text: string;
  href: string | null;
  rect: Rect;
  reason: string | null;
  xpath: string | null;
  selector: string;
}

interface InteractabilityInfo {
  clickable: boolean;
  reason: string | null;
  possibleFalsePositive: boolean;
  secondClassCitizen: boolean;
}

interface MarkerElement extends HTMLDivElement {
  dataset: {
    hintIndex: string;
    hintXpath: string;
  };
}

// Constants
const SAFE_ALL_SELECTOR = ":not(form)";
const HINT_CONTAINER_ID = "autai-hint-container";
const ANGULAR_CLICK_ATTRIBUTES = [
  "ng-click",
  "data-ng-click",
  "x-ng-click",
  "ng:click",
  "data-ng:click",
  "x-ng:click",
  "ng_click",
  "data-ng_click",
  "x-ng_click",
];

const CLICKABLE_ROLES = [
  "button",
  "tab",
  "link",
  "checkbox",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "radio",
];

// Type guards
function isHTMLInputElement(el: Element): el is HTMLInputElement {
  return el.tagName.toLowerCase() === "input";
}

function isHTMLTextAreaElement(el: Element): el is HTMLTextAreaElement {
  return el.tagName.toLowerCase() === "textarea";
}

function isHTMLSelectElement(el: Element): el is HTMLSelectElement {
  return el.tagName.toLowerCase() === "select";
}

function isHTMLDetailsElement(el: Element): el is HTMLDetailsElement {
  return el.tagName.toLowerCase() === "details";
}

function isHTMLAreaElement(el: Element): el is HTMLAreaElement {
  return el.tagName.toLowerCase() === "area";
}

function isHTMLImageElement(el: Element): el is HTMLImageElement {
  return el.tagName.toLowerCase() === "img";
}

function isHTMLLabelElement(el: Element): el is HTMLLabelElement {
  return el.tagName.toLowerCase() === "label";
}

// Helper functions
function isVisible(element: Element, checkViewport = true): boolean {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);

  // Check if element has dimensions and is not hidden by CSS
  if (
    rect.width <= 0 ||
    rect.height <= 0 ||
    style.visibility === "hidden" ||
    style.display === "none" ||
    parseFloat(style.opacity) <= 0
  ) {
    return false;
  }

  // Check viewport constraints if requested
  if (checkViewport) {
    if (
      rect.bottom <= 0 ||
      rect.top >= window.innerHeight ||
      rect.right <= 0 ||
      rect.left >= window.innerWidth
    ) {
      return false;
    }
  }

  // Check if element is actually visible (not just in DOM)
  const rects = element.getClientRects();
  if (rects.length === 0) return false;

  // Check if any rect has actual area
  for (const r of Array.from(rects)) {
    if (r.width > 0 && r.height > 0) {
      return true;
    }
  }
  return false;
}

// Get all elements including shadow DOM
function getAllElements(
  root: Element | DocumentFragment,
  elements: Element[] = []
): Element[] {
  const children = root.querySelectorAll("*");
  for (const element of Array.from(children)) {
    elements.push(element);
    if (element.shadowRoot) {
      getAllElements(element.shadowRoot, elements);
    }
  }
  return elements;
}

// Check if element is scrollable
function isScrollableElement(element: Element): boolean {
  const style = window.getComputedStyle(element);
  const overflowY = style.overflowY;
  const overflowX = style.overflowX;
  return (
    (element.scrollHeight > element.clientHeight &&
      ["auto", "scroll"].includes(overflowY)) ||
    (element.scrollWidth > element.clientWidth &&
      ["auto", "scroll"].includes(overflowX))
  );
}

function hasAngularClickHandler(element: Element): boolean {
  return ANGULAR_CLICK_ATTRIBUTES.some((attr) => element.hasAttribute(attr));
}

function hasJsAction(element: Element): boolean {
  if (!element.hasAttribute("jsaction")) return false;

  const jsaction = element.getAttribute("jsaction") || "";
  const rules = jsaction.split(";");

  for (const rule of rules) {
    const parts = rule.trim().split(":");
    if (parts.length === 1 || (parts.length === 2 && parts[0] === "click")) {
      const actionParts = (parts.length === 1 ? parts[0] : parts[1])
        .trim()
        .split(".");
      if (
        actionParts[0] !== "none" &&
        actionParts[actionParts.length - 1] !== "_"
      ) {
        return true;
      }
    }
  }

  return false;
}

function isInteractable(element: Element): InteractabilityInfo {
  const tagName = element.tagName.toLowerCase();
  const style = window.getComputedStyle(element);
  let clickable = false;
  let reason: string | null = null;
  let possibleFalsePositive = false;
  let secondClassCitizen = false;

  // Check aria-disabled
  const ariaDisabled = element.getAttribute("aria-disabled");
  if (ariaDisabled && ["", "true"].includes(ariaDisabled.toLowerCase())) {
    return {
      clickable: false,
      reason: null,
      possibleFalsePositive: false,
      secondClassCitizen: false,
    };
  }

  // Native clickable elements
  switch (tagName) {
    case "a":
      clickable = true;
      break;
    case "button":
      clickable = !(element as HTMLButtonElement).disabled;
      break;
    case "textarea":
      const textarea = element as HTMLTextAreaElement;
      clickable = !textarea.disabled && !textarea.readOnly;
      break;
    case "input":
      const input = element as HTMLInputElement;
      clickable =
        input.type !== "hidden" &&
        !input.disabled &&
        !(
          input.readOnly &&
          ["text", "search", "email", "url", "tel", "password"].includes(
            input.type
          )
        );
      break;
    case "select":
      clickable = !(element as HTMLSelectElement).disabled;
      break;
    case "label":
      const label = element as HTMLLabelElement;
      clickable =
        label.control != null && !(label.control as HTMLInputElement).disabled;
      break;
    case "img":
      clickable = ["zoom-in", "zoom-out"].includes(style.cursor);
      break;
    case "details":
      clickable = true;
      reason = "Open/Close";
      break;
    case "object":
    case "embed":
      clickable = true;
      break;
    case "body":
      // Special handling for body element
      if (element === document.body) {
        // Frame focusing - check if this is a focusable frame
        if (
          window.innerWidth > 3 &&
          window.innerHeight > 3 &&
          document.body.tagName.toLowerCase() !== "frameset"
        ) {
          // Check if we're in an iframe that can be focused
          if (window !== window.top) {
            clickable = true;
            reason = "Frame";
          } else if (isScrollableElement(element)) {
            clickable = true;
            reason = "Scroll";
          }
        }
      }
      break;
    case "div":
    case "ol":
    case "ul":
      // Scrollable containers
      if (isScrollableElement(element)) {
        clickable = true;
        reason = "Scroll";
      }
      break;
  }

  // Check for event handlers
  if (!clickable) {
    clickable =
      element.hasAttribute("onclick") ||
      hasAngularClickHandler(element) ||
      hasJsAction(element);
  }

  // Check role attribute
  if (!clickable) {
    const role = element.getAttribute("role");
    if (role && CLICKABLE_ROLES.includes(role.toLowerCase())) {
      clickable = true;
    }
  }

  // Check contentEditable
  if (!clickable) {
    const contentEditable = element.getAttribute("contentEditable");
    if (
      contentEditable &&
      ["", "contenteditable", "true"].includes(contentEditable.toLowerCase())
    ) {
      clickable = true;
    }
  }

  // Check class name for button-like classes
  if (!clickable) {
    const className = element.getAttribute("class") || "";
    if (className.toLowerCase().includes("button")) {
      clickable = true;
      possibleFalsePositive = true;
    }
  }

  // Check cursor style for clickable appearance
  if (!clickable) {
    const cursor = style.cursor || "";
    if (["pointer", "zoom-in", "zoom-out"].includes(cursor)) {
      clickable = true;
      possibleFalsePositive = true;
    }
  }

  // Check tabindex
  if (!clickable) {
    const tabIndexStr = element.getAttribute("tabindex");
    if (tabIndexStr) {
      const tabIndex = parseInt(tabIndexStr);
      if (!isNaN(tabIndex) && tabIndex >= 0) {
        clickable = true;
        secondClassCitizen = true;
      }
    }
  }

  return { clickable, reason, possibleFalsePositive, secondClassCitizen };
}

function getLinkText(element: Element): string {
  const tagName = element.tagName.toLowerCase();
  let linkText = "";

  if (isHTMLInputElement(element)) {
    if (element.labels && element.labels.length > 0) {
      linkText = element.labels[0].textContent?.trim() || "";
      if (linkText.endsWith(":")) {
        linkText = linkText.slice(0, -1);
      }
    } else if (element.type === "file") {
      linkText = "Choose File";
    } else if (element.type !== "password") {
      linkText = element.value || element.placeholder || "";
    }
  } else if (tagName === "a" && !element.textContent?.trim()) {
    const img = element.querySelector("img");
    if (img) {
      linkText = img.alt || img.title || "";
    }
  } else if (element.textContent) {
    linkText = element.textContent.slice(0, 256);
  } else if (element.hasAttribute("title")) {
    linkText = element.getAttribute("title") || "";
  } else {
    linkText = element.innerHTML.slice(0, 256);
  }

  return linkText.trim();
}

// Helper function to compare rectangles
function areRectsEqual(
  rect1: DOMRect | Rect,
  rect2: Rect,
  includeSize = false
): boolean {
  const positionMatch =
    Math.abs(rect1.top - rect2.top) < 1 &&
    Math.abs(rect1.left - rect2.left) < 1;

  if (!includeSize) return positionMatch;

  return (
    positionMatch &&
    Math.abs(rect1.width - rect2.width) < 1 &&
    Math.abs(rect1.height - rect2.height) < 1
  );
}

// Helper function to find element by rectangle
function findElementByRect(
  elements: Element[],
  targetRect: Rect,
  includeSize = false
): Element | undefined {
  return elements.find((el) => {
    const rect = el.getBoundingClientRect();
    return areRectsEqual(rect, targetRect, includeSize);
  });
}

// Helper function to evaluate XPath
function evaluateXPath(xpath: string): Element | null {
  const result = document.evaluate(
    xpath,
    document,
    null,
    XPathResult.FIRST_ORDERED_NODE_TYPE,
    null
  );
  return result.singleNodeValue as Element | null;
}

// Generate XPath for an element
function getXPath(element: Element): string | null {
  if (!element) return null;

  // Handle special cases
  if (element.id) {
    return `//*[@id="${element.id}"]`;
  }

  // Build path from element to root
  const segments: string[] = [];
  let current: Element | null = element;

  while (current && current.nodeType === Node.ELEMENT_NODE) {
    let index = 1;
    let sibling = current.previousSibling;

    // Count preceding siblings of the same tag name
    while (sibling) {
      if (
        sibling.nodeType === Node.ELEMENT_NODE &&
        (sibling as Element).tagName === current.tagName
      ) {
        index++;
      }
      sibling = sibling.previousSibling;
    }

    const tagName = current.tagName.toLowerCase();
    const segment = tagName + "[" + index + "]";
    segments.unshift(segment);

    // Stop at document root or shadow root
    if (
      current.parentNode &&
      current.parentNode.nodeType === Node.DOCUMENT_NODE
    ) {
      break;
    }

    current = current.parentElement;
  }

  const xpath = segments.length ? "/" + segments.join("/") : null;
  if (!xpath) {
    console.warn(
      `[HintDetector] Failed to generate XPath for element:`,
      element
    );
  }
  return xpath;
}

// Helper function to dispatch input events
function dispatchInputEvents(element: Element): void {
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

// Safe wrapper for CSS selector generation
function generateCssSelector(element: Element): string {
  try {
    if (typeof getCssSelector === "function") {
      return getCssSelector(element);
    }
  } catch (error) {
    console.warn("[HintDetector] Failed to generate CSS selector:", error);
  }
  // Return empty string if CSS selector generation fails
  // XPath will be used as the primary identifier
  return "";
}

// Create hint marker overlay container
function createHintContainer(): HTMLDivElement {
  let container = document.getElementById(HINT_CONTAINER_ID) as HTMLDivElement;
  if (container) {
    container.remove();
  }

  container = document.createElement("div");
  container.id = HINT_CONTAINER_ID;

  container.style.cssText = `
    position: fixed !important;
    top: 0 !important;
    left: 0 !important;
    width: 100vw !important;
    height: 100vh !important;
    pointer-events: none !important;
    z-index: 2147483647 !important;
    isolation: isolate !important;
  `;

  document.documentElement.appendChild(container);
  return container;
}

// Clear existing hint markers
function clearHints(): void {
  const container = document.getElementById(HINT_CONTAINER_ID);
  if (container) {
    container.innerHTML = "";
  }
}

// Execute appropriate action on element
function executeClickAction(element: Element): void {
  const tagName = element.tagName;
  if (isHTMLDetailsElement(element)) {
    console.log(`[HintDetector] Toggling DETAILS element open state`);
    element.open = !element.open;
  } else if (
    isHTMLInputElement(element) ||
    isHTMLTextAreaElement(element) ||
    isHTMLSelectElement(element)
  ) {
    console.log(`[HintDetector] Focusing ${tagName} element`);
    element.focus();
  } else {
    console.log(`[HintDetector] Clicking ${tagName} element`);
    (element as HTMLElement).click();
  }
}

// Determine element type for AI understanding
function determineElementType(hint: HintItem): string {
  if (hint.href && hint.tagName === "a") return "link";
  if (hint.tagName === "button") return "button";
  if (hint.tagName === "input") return "input";
  if (hint.tagName === "select") return "select";
  if (hint.tagName === "textarea") return "textarea";
  if (hint.reason === "Scroll") return "scrollable";
  if (hint.reason === "Frame") return "frame";
  if (hint.reason === "Open/Close") return "details";
  return "interactive";
}

// Main hint detection function
function detectHints(viewportOnly = true): HintItem[] {
  const hints: HintItem[] = [];
  const allElements = getAllElements(document.documentElement);

  // First pass: collect all hints
  allElements.forEach((element) => {
    if (!isVisible(element, viewportOnly)) return;

    const interactInfo = isInteractable(element);
    if (!interactInfo.clickable) return;

    const rect = element.getBoundingClientRect();
    const linkText = getLinkText(element);

    // Handle image maps
    if (isHTMLImageElement(element)) {
      const mapName = element.getAttribute("usemap");
      if (mapName) {
        const map = document.querySelector(
          'map[name="' + mapName.replace(/^#/, "") + '"]'
        );
        if (map) {
          const areas = map.getElementsByTagName("area");
          for (const area of Array.from(areas)) {
            const areaRect = area.getBoundingClientRect();
            if (areaRect.width > 0 && areaRect.height > 0) {
              hints.push({
                rect: {
                  top: areaRect.top,
                  left: areaRect.left,
                  width: areaRect.width,
                  height: areaRect.height,
                  right: areaRect.right,
                  bottom: areaRect.bottom,
                },
                linkText: area.alt || area.title || "Area",
                tagName: "area",
                href: area.href || null,
                reason: interactInfo.reason,
                xpath: getXPath(area),
                selector: generateCssSelector(area),
                possibleFalsePositive: false,
                secondClassCitizen: false,
              });
            }
          }
          return; // Skip the image itself
        }
      }
    }

    hints.push({
      rect: {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        right: rect.right,
        bottom: rect.bottom,
      },
      linkText,
      tagName: element.tagName.toLowerCase(),
      href: (element as HTMLAnchorElement).href || null,
      reason: interactInfo.reason,
      xpath: getXPath(element),
      selector: generateCssSelector(element),
      possibleFalsePositive: interactInfo.possibleFalsePositive,
      secondClassCitizen: interactInfo.secondClassCitizen,
    });
  });

  // Filter out false positives and duplicates
  const filteredHints = hints.filter((hint, index) => {
    if (!hint.possibleFalsePositive) return true;

    // Check if any descendant in nearby hints is clickable
    const lookbackWindow = 6;
    const start = Math.max(0, index - lookbackWindow);

    for (let i = start; i < index; i++) {
      const candidateElement = findElementByRect(allElements, hints[i].rect);

      if (candidateElement) {
        let candidateDescendant: Element | null = candidateElement;
        // Check up to 3 levels of ancestry
        for (let j = 0; j < 3; j++) {
          candidateDescendant = candidateDescendant?.parentElement;
          const currentElement = findElementByRect(allElements, hint.rect);
          if (candidateDescendant === currentElement) {
            return false; // This is a false positive
          }
        }
      }
    }

    return true;
  });

  // Remove duplicate hints for label controls
  const labelledElements = new Set<string>();
  const deduplicatedHints = filteredHints.filter((hint) => {
    if (hint.tagName === "label") {
      const element = findElementByRect(allElements, hint.rect);

      if (element && isHTMLLabelElement(element) && element.control) {
        const controlId = element.control.id || String(element.control);
        if (labelledElements.has(controlId)) {
          return false;
        }
        labelledElements.add(controlId);
      }
    }
    return true;
  });

  // Log statistics about XPath generation
  const validXPaths = deduplicatedHints.filter((h) => h.xpath).length;
  console.log(
    `[HintDetector] Detected ${
      deduplicatedHints.length
    } hints, ${validXPaths} with valid XPaths (${Math.round(
      (validXPaths / deduplicatedHints.length) * 100
    )}%)`
  );

  return deduplicatedHints;
}

// Display hint markers
function showHints(): void {
  clearHints();
  const container = createHintContainer();

  // Use cached elements if available, otherwise generate new ones
  if (!cachedElements || cacheViewportOnly !== true) {
    console.log(
      "[HintDetector] No cached elements for viewport, generating new hints"
    );
    getInteractableElements(true); // This will populate the cache
  }

  // Filter cached elements to only show those in viewport
  const visibleElements = cachedElements!.filter((element) => {
    // Check if element is in viewport
    const rect = element.rect;
    return !(
      rect.bottom <= 0 ||
      rect.top >= window.innerHeight ||
      rect.right <= 0 ||
      rect.left >= window.innerWidth
    );
  });

  console.log(
    `[HintDetector] Showing ${visibleElements.length} hints from ${
      cachedElements!.length
    } cached elements`
  );

  visibleElements.forEach((element, visibleIndex) => {
    const marker = document.createElement("div") as MarkerElement;
    const hintLabel = String(visibleIndex); // Use the persistent ID

    marker.style.cssText = `
      position: fixed !important;
      left: ${element.rect.left}px !important;
      top: ${element.rect.top}px !important;
      background: linear-gradient(to bottom, #FFF785 0%, #FFC542 100%) !important;
      border: 1px solid #C38A22 !important;
      border-radius: 3px !important;
      box-shadow: 0px 3px 7px 0px rgba(0, 0, 0, 0.3) !important;
      color: #302505 !important;
      font-family: Helvetica, Arial, sans-serif !important;
      font-size: 11px !important;
      font-weight: bold !important;
      padding: 2px 5px !important;
      text-align: center !important;
      user-select: none !important;
      cursor: pointer !important;
      min-width: 16px !important;
      z-index: 2147483647 !important;
      pointer-events: auto !important;
    `;

    marker.textContent = hintLabel;
    marker.title = element.reason || element.text || element.href || "";

    // Store hint data on the marker for click handling
    marker.dataset.hintIndex = String(element.id);
    marker.dataset.hintXpath = element.xpath || "";

    // Add click handler to the marker
    marker.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const elementId = parseInt(marker.dataset.hintIndex);

      console.log(`[HintDetector] Marker clicked for element ID ${elementId}`);

      // Use the existing clickElementById function which handles all the fallback logic
      clickElementById(elementId);
    });

    container.appendChild(marker);
  });
}

// Hide hint markers
function hideHints(): void {
  clearHints();
}

// Cache for persistent elements across AI interactions
let cachedElements: InteractableElement[] | null = null;
let cacheViewportOnly: boolean | null = null;

// Get structured data for AI agent
function getInteractableElements(viewportOnly = true): InteractableElement[] {
  // Return cached elements if available and viewport setting matches
  if (cachedElements && cacheViewportOnly === viewportOnly) {
    console.log(
      `[HintDetector] Returning cached elements (${cachedElements.length} items)`
    );
    return cachedElements;
  }

  // Generate new elements and cache them
  console.log("[HintDetector] Generating new elements array for AI agent");
  const hints = detectHints(viewportOnly);
  cachedElements = hints.map((hint, index) => ({
    id: index + 1,
    type: determineElementType(hint),
    text: hint.linkText,
    href: hint.href,
    rect: hint.rect,
    reason: hint.reason,
    xpath: hint.xpath,
    selector: hint.selector || "",
  }));
  cacheViewportOnly = viewportOnly;

  console.log(
    `[HintDetector] Cached ${cachedElements.length} elements for AI agent`
  );
  return cachedElements;
}

// Explicitly refresh the cached elements (called by AI agent when needed)
function refreshInteractableElements(
  viewportOnly = true
): InteractableElement[] {
  console.log("[HintDetector] Explicitly refreshing cached elements");
  cachedElements = null;
  cacheViewportOnly = null;
  return getInteractableElements(viewportOnly);
}

// Get DOM element by hint ID
function getElementByHintId(id: number): Element | null {
  const elements = getInteractableElements(false);
  const targetElement = elements[id - 1];
  if (!targetElement) return null;

  // Try CSS selector first
  if (targetElement.selector) {
    try {
      const element = document.querySelector(targetElement.selector);
      if (element) {
        console.log(
          `[HintDetector] Found element ${id} using CSS selector: ${targetElement.selector}`
        );
        return element;
      }
    } catch (error) {
      console.warn(
        `[HintDetector] CSS selector failed for element ${id}:`,
        error
      );
    }
  }

  // Fallback to XPath
  if (targetElement.xpath) {
    const element = evaluateXPath(targetElement.xpath);
    if (element) {
      console.log(
        `[HintDetector] Found element ${id} using XPath: ${targetElement.xpath}`
      );
      return element;
    }
  }

  // Final fallback to rectangle comparison
  console.log(
    `[HintDetector] CSS selector and XPath failed for element ${id}, falling back to rectangle comparison`
  );
  const allElements = getAllElements(document.documentElement);
  const element = findElementByRect(allElements, targetElement.rect, true);
  if (element) {
    console.log(
      `[HintDetector] Found element ${id} using rectangle comparison fallback`
    );
    return element;
  }

  console.warn(
    `[HintDetector] Failed to find element ${id} using all methods (CSS selector, XPath, and rectangle comparison)`
  );
  return null;
}

// Click element by ID (for AI agent)
function clickElementById(id: number): boolean {
  const element = getElementByHintId(id);
  if (!element) {
    console.log(
      `[HintDetector] Failed to click element ${id}: element not found`
    );
    return false;
  }

  console.log(`[HintDetector] Clicking element ${id}`);
  executeClickAction(element);
  return true;
}

// Type text with proper event simulation
function typeTextById(
  id: number,
  text: string
): { success: boolean; error?: string } {
  const element = getElementByHintId(id);
  if (!element) return { success: false, error: "Element not found" };

  element.focus();

  // Handle different input types
  if ("value" in element) {
    (element as HTMLInputElement).value = "";
    // Simulate typing each character
    for (const char of text) {
      (element as HTMLInputElement).value += char;
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }
    dispatchInputEvents(element);
  } else if ((element as HTMLElement).isContentEditable) {
    (element as HTMLElement).textContent = text;
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }

  return { success: true };
}

// Extract text using same logic as getLinkText
function getElementTextContent(id: number): string {
  const element = getElementByHintId(id);
  if (!element) return "";

  return getLinkText(element);
}

// Get/Set element values for forms
function getElementValue(id: number): string | null {
  const element = getElementByHintId(id);
  if (!element) return null;

  if ("value" in element) return (element as HTMLInputElement).value;
  if ((element as HTMLElement).isContentEditable)
    return (element as HTMLElement).textContent;
  return null;
}

function setElementValue(
  id: number,
  value: string
): { success: boolean; error?: string } {
  const element = getElementByHintId(id);
  if (!element) return { success: false, error: "Element not found" };

  if ("value" in element) {
    (element as HTMLInputElement).value = value;
    dispatchInputEvents(element);
    return { success: true };
  } else if ((element as HTMLElement).isContentEditable) {
    (element as HTMLElement).textContent = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    return { success: true };
  }

  return { success: false, error: "Element does not support value setting" };
}

// Hover action
function hoverElementById(id: number): { success: boolean; error?: string } {
  const element = getElementByHintId(id);
  if (!element) return { success: false, error: "Element not found" };

  const rect = element.getBoundingClientRect();
  const event = new MouseEvent("mouseover", {
    view: window,
    bubbles: true,
    cancelable: true,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
  });

  element.dispatchEvent(event);
  return { success: true };
}

// Scroll to element
function scrollToElementById(id: number): { success: boolean; error?: string } {
  const element = getElementByHintId(id);
  if (!element) return { success: false, error: "Element not found" };

  element.scrollIntoView({ behavior: "smooth", block: "center" });
  return { success: true };
}

// Performance optimization utilities
function throttle<T extends (...args: any[]) => void>(
  func: T,
  delay: number
): T {
  let lastCall = 0;
  let timeout: NodeJS.Timeout | undefined;
  return ((...args: Parameters<T>) => {
    const now = Date.now();
    if (timeout) clearTimeout(timeout);
    if (now - lastCall >= delay) {
      lastCall = now;
      func(...args);
    } else {
      timeout = setTimeout(() => {
        lastCall = Date.now();
        func(...args);
      }, delay - (now - lastCall));
    }
  }) as T;
}

function debounce<T extends (...args: any[]) => void>(
  func: T,
  delay: number
): T {
  let timeout: NodeJS.Timeout | undefined;
  return ((...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), delay);
  }) as T;
}

// Initialize hint detector
(function () {
  // Make functions available globally
  (window as any).detectHints = detectHints;
  (window as any).showHints = showHints;
  (window as any).hideHints = hideHints;
  (window as any).getInteractableElements = getInteractableElements;
  (window as any).refreshInteractableElements = refreshInteractableElements;
  (window as any).clickElementById = clickElementById;
  (window as any).getElementByHintId = getElementByHintId;
  (window as any).typeTextById = typeTextById;
  (window as any).getElementTextContent = getElementTextContent;
  (window as any).getElementValue = getElementValue;
  (window as any).setElementValue = setElementValue;
  (window as any).hoverElementById = hoverElementById;
  (window as any).scrollToElementById = scrollToElementById;

  // Use requestIdleCallback for periodic updates
  const refreshHintsIdle = () => {
    if ("requestIdleCallback" in window) {
      requestIdleCallback(
        () => {
          showHints();
        },
        { timeout: 2000 }
      );
    } else {
      setTimeout(() => showHints(), 2000);
    }
  };

  // Debounced refresh for mutations
  const refreshHintsDebounced = debounce(showHints, 100);

  // Throttled refresh for scroll/resize
  const refreshHintsThrottled = throttle(showHints, 150);

  // Auto-show hints when page loads and populate cache
  setTimeout(() => {
    console.log(
      "[HintDetector] Initial page load - populating cache and showing hints"
    );
    refreshInteractableElements(true); // Populate cache with full page elements
    showHints(); // Show visible hints
  }, 1000);

  // Use throttled refresh for scroll/resize events
  window.addEventListener("scroll", refreshHintsThrottled, { passive: true });
  window.addEventListener("resize", refreshHintsThrottled, { passive: true });

  // Set up mutation observer for dynamic content with debounced refresh
  const observer = new MutationObserver(() => {
    refreshHintsDebounced();
  });

  // Start observing the document for changes
  if (document.body) {
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "class", "hidden"],
    });
  }

  // Use requestIdleCallback for periodic updates
  const periodicRefresh = () => {
    refreshHintsIdle();
    // Schedule next refresh
    setTimeout(periodicRefresh, 5000);
  };
  setTimeout(periodicRefresh, 5000);

  console.log("[HintDetector] TypeScript hint detector initialized");
})();
