# BrowserActionService Implementation Plan

## Overview

This document provides a detailed implementation plan for the BrowserActionService, which will enable AI agents to perform browser automation actions directly on WebContentsView instances in the main process.

## Key Design Decisions

1. **Leverage Existing Infrastructure**: The plan maximizes use of existing hintDetector.js functionality:

   - `getInteractableElements()` already provides structured element data with XPath
   - `clickElementById()` already handles element clicking with XPath lookup and fallbacks
   - `detectHints()` provides raw element data including the actual DOM elements
   - `getLinkText()` already extracts appropriate text from various element types

2. **Minimal New Code**: Only add what's missing:

   - `typeTextById()` for text input
   - `getElementByHintId()` for DOM element access
   - `setElementValue()`/`getElementValue()` for form manipulation
   - `hoverElementById()` and `scrollToElementById()` for additional interactions

3. **Consistent Patterns**: All new functions follow the existing patterns in hintDetector.js

## Architecture Principles

1. **Direct Access**: Service runs in main process with direct access to WebContentsView instances
2. **No IPC Bridge**: Actions execute directly without IPC overhead
3. **Multi-Tab Support**: All methods accept taskId and pageId to target specific tabs
4. **Action Registry Pattern**: Extensible design for adding new actions
5. **JavaScript Injection**: Leverage existing hintDetector.js infrastructure

## Service Structure

### Core Service Class

```typescript
// electron/main/services/BrowserActionService.ts
export class BrowserActionService {
  private stateManager: StateManager;
  private scriptLoader: typeof import("../scripts/hintDetectorLoader");

  constructor(stateManager: StateManager) {
    this.stateManager = stateManager;
    this.scriptLoader = await import("../scripts/hintDetectorLoader");
  }

  // Helper method to get WebContentsView
  private async getWebContentsView(
    taskId: string,
    pageId: string
  ): Promise<WebContentsView> {
    const view = this.stateManager.getViewForPage(taskId, pageId);
    if (!view)
      throw new Error(`No view found for task ${taskId}, page ${pageId}`);

    const webView = this.stateManager.getWebContentsView(view.id);
    if (!webView)
      throw new Error(`WebContentsView not found for view ${view.id}`);

    return webView;
  }
}
```

## Core Action Methods

### 1. Navigation Actions

```typescript
async navigateTo(taskId: string, pageId: string, url: string): Promise<ActionResult> {
  const webView = await this.getWebContentsView(taskId, pageId);
  await webView.webContents.loadURL(url);
  return { success: true, data: { url } };
}

async goBack(taskId: string, pageId: string): Promise<ActionResult> {
  const webView = await this.getWebContentsView(taskId, pageId);
  if (webView.webContents.canGoBack()) {
    webView.webContents.goBack();
    return { success: true };
  }
  return { success: false, error: 'Cannot go back' };
}

async refresh(taskId: string, pageId: string): Promise<ActionResult> {
  const webView = await this.getWebContentsView(taskId, pageId);
  webView.webContents.reload();
  return { success: true };
}
```

### 2. Element Interaction Actions

```typescript
async clickElement(taskId: string, pageId: string, elementId: number): Promise<ActionResult> {
  const webView = await this.getWebContentsView(taskId, pageId);
  // Use existing clickElementById which already handles XPath lookup and special cases
  const result = await webView.webContents.executeJavaScript(`
    window.clickElementById && window.clickElementById(${elementId})
  `);
  return { success: result === true, data: result };
}

async typeText(taskId: string, pageId: string, elementId: number, text: string): Promise<ActionResult> {
  const webView = await this.getWebContentsView(taskId, pageId);
  // Use the new typeTextById function that will be added to hintDetector
  const result = await webView.webContents.executeJavaScript(`
    window.typeTextById && window.typeTextById(${elementId}, ${JSON.stringify(text)})
  `);
  return result || { success: false, error: 'Failed to type text' };
}

async pressKey(taskId: string, pageId: string, key: string): Promise<ActionResult> {
  const webView = await this.getWebContentsView(taskId, pageId);

  // Map common keys to Electron accelerator format
  const keyMap: Record<string, string> = {
    'enter': 'Return',
    'tab': 'Tab',
    'escape': 'Escape',
    'backspace': 'Backspace',
    'delete': 'Delete',
    'space': 'Space'
  };

  const electronKey = keyMap[key.toLowerCase()] || key;
  webView.webContents.sendInputEvent({
    type: 'keyDown',
    keyCode: electronKey
  });

  return { success: true };
}
```

### 3. Content Extraction Actions

```typescript
async getPageElements(taskId: string, pageId: string, options?: { viewportOnly?: boolean }): Promise<InteractableElement[]> {
  const webView = await this.getWebContentsView(taskId, pageId);
  const viewportOnly = options?.viewportOnly ?? true;

  const elements = await webView.webContents.executeJavaScript(`
    window.getInteractableElements && window.getInteractableElements(${viewportOnly})
  `);

  return elements || [];
}

async extractText(taskId: string, pageId: string, elementId?: number): Promise<string> {
  const webView = await this.getWebContentsView(taskId, pageId);

  if (elementId) {
    // Use the new getElementTextContent function that understands different element types
    const script = `window.getElementTextContent && window.getElementTextContent(${elementId})`;
    return await webView.webContents.executeJavaScript(script);
  } else {
    // Get full page text
    return await webView.webContents.executeJavaScript(`document.body.innerText`);
  }
}

async captureScreenshot(taskId: string, pageId: string, options?: ScreenshotOptions): Promise<Buffer> {
  const webView = await this.getWebContentsView(taskId, pageId);
  const image = await webView.webContents.capturePage(options?.rect);
  return image.toPNG();
}
```

### 4. Scrolling Actions

```typescript
async scrollPage(taskId: string, pageId: string, direction: 'up' | 'down', amount?: number): Promise<ActionResult> {
  const webView = await this.getWebContentsView(taskId, pageId);
  const pixels = amount || 500;

  const script = `
    window.scrollBy({
      top: ${direction === 'down' ? pixels : -pixels},
      behavior: 'smooth'
    });
    { success: true, scrollY: window.scrollY }
  `;

  return await webView.webContents.executeJavaScript(script);
}

async scrollToElement(taskId: string, pageId: string, elementId: number): Promise<ActionResult> {
  const webView = await this.getWebContentsView(taskId, pageId);

  // Use the new scrollToElementById function
  const result = await webView.webContents.executeJavaScript(`
    window.scrollToElementById && window.scrollToElementById(${elementId})
  `);

  return result || { success: false, error: 'Failed to scroll to element' };
}
```

### 5. Advanced Actions

```typescript
async hover(taskId: string, pageId: string, elementId: number): Promise<ActionResult> {
  const webView = await this.getWebContentsView(taskId, pageId);

  // Use the new hoverElementById function
  const result = await webView.webContents.executeJavaScript(`
    window.hoverElementById && window.hoverElementById(${elementId})
  `);

  return result || { success: false, error: 'Failed to hover element' };
}

async waitForSelector(taskId: string, pageId: string, selector: string, timeout: number = 5000): Promise<boolean> {
  const webView = await this.getWebContentsView(taskId, pageId);
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const exists = await webView.webContents.executeJavaScript(`
      !!document.querySelector(${JSON.stringify(selector)})
    `);

    if (exists) return true;
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return false;
}
```

### 6. Form Handling Actions

```typescript
async selectOption(taskId: string, pageId: string, elementId: number, value: string): Promise<ActionResult> {
  const webView = await this.getWebContentsView(taskId, pageId);

  // Use setElementValue which handles SELECT elements
  const result = await webView.webContents.executeJavaScript(`
    window.setElementValue && window.setElementValue(${elementId}, ${JSON.stringify(value)})
  `);

  return result || { success: false, error: 'Failed to select option' };
}

async setCheckbox(taskId: string, pageId: string, elementId: number, checked: boolean): Promise<ActionResult> {
  const webView = await this.getWebContentsView(taskId, pageId);

  // For checkboxes, we'll use clickElementById if state needs to change
  const script = `
    (function() {
      const element = window.getElementByHintId && window.getElementByHintId(${elementId});
      if (!element || element.type !== 'checkbox') {
        return { success: false, error: 'Element is not a checkbox' };
      }

      if (element.checked !== ${checked}) {
        // Use the existing click function which handles proper event simulation
        return window.clickElementById(${elementId});
      }
      return { success: true, checked: element.checked };
    })()
  `;

  return await webView.webContents.executeJavaScript(script);
}
```

## Required hintDetector.js Enhancements

### Existing Functions We Leverage:

1. **`window.getInteractableElements(viewportOnly)`** - Already returns structured data:

   ```javascript
   {
     id: number,          // 1-based index
     type: string,        // Element type classification
     text: string,        // Extracted via getLinkText()
     href: string,        // For links
     rect: DOMRect,       // Bounding box
     xpath: string,       // XPath for element location
     selector: string     // Simple selector
   }
   ```

2. **`window.clickElementById(id)`** - Already handles:

   - XPath-based element lookup
   - Rectangle-based fallback
   - Special cases (DETAILS, INPUT, TEXTAREA, SELECT)
   - Proper event simulation via `executeClickAction()`

3. **`window.detectHints(viewportOnly)`** - Returns raw hint data including element properties

### New Functions to Add:

```javascript
// Get DOM element by hint ID
window.getElementByHintId = function (id) {
  // Use the existing XPath from getInteractableElements
  const elements = window.getInteractableElements(false);
  const targetElement = elements[id - 1]; // Convert to 0-based index
  if (!targetElement || !targetElement.xpath) return null;

  const result = document.evaluate(
    targetElement.xpath,
    document,
    null,
    XPathResult.FIRST_ORDERED_NODE_TYPE,
    null
  );
  return result.singleNodeValue;
};

// Type text with proper event simulation
window.typeTextById = function (id, text) {
  const element = window.getElementByHintId(id);
  if (!element) return { success: false, error: "Element not found" };

  element.focus();

  // Handle different input types
  if ("value" in element) {
    element.value = "";
    // Simulate typing each character
    for (const char of text) {
      element.value += char;
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }
    element.dispatchEvent(new Event("change", { bubbles: true }));
  } else if (element.isContentEditable) {
    element.textContent = text;
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }

  return { success: true };
};

// Extract text using same logic as getLinkText
window.getElementTextContent = function (id) {
  const element = window.getElementByHintId(id);
  if (!element) return "";

  // Reuse getLinkText logic for consistency
  return getLinkText(element);
};

// Get/Set element values for forms
window.getElementValue = function (id) {
  const element = window.getElementByHintId(id);
  if (!element) return null;

  if ("value" in element) return element.value;
  if (element.isContentEditable) return element.textContent;
  return null;
};

window.setElementValue = function (id, value) {
  const element = window.getElementByHintId(id);
  if (!element) return { success: false, error: "Element not found" };

  const tagName = element.tagName.toLowerCase();

  if ("value" in element) {
    element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return { success: true };
  } else if (element.isContentEditable) {
    element.textContent = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    return { success: true };
  }

  return { success: false, error: "Element does not support value setting" };
};

// Hover action
window.hoverElementById = function (id) {
  const element = window.getElementByHintId(id);
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
};

// Scroll to element
window.scrollToElementById = function (id) {
  const element = window.getElementByHintId(id);
  if (!element) return { success: false, error: "Element not found" };

  element.scrollIntoView({ behavior: "smooth", block: "center" });
  return { success: true };
};
```

## Type Definitions

```typescript
// electron/shared/types/browserActions.ts
export interface ActionResult {
  success: boolean;
  data?: any;
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
```

## Error Handling Strategy

1. **View Not Found**: Clear error when task/page doesn't exist
2. **Element Not Found**: Return structured error with element ID
3. **JavaScript Errors**: Wrap all injected scripts in try-catch
4. **Navigation Errors**: Handle page load failures gracefully
5. **Timeout Handling**: Configurable timeouts for all async operations

## Security Considerations

1. **Input Sanitization**: Escape all user inputs in JavaScript
2. **XSS Prevention**: Use JSON.stringify for string injection
3. **Origin Validation**: Verify page origin before actions
4. **Permission Model**: Optional action permission system

## Performance Optimizations

1. **Script Caching**: Cache hintDetector.js in memory
2. **Batch Actions**: Support executing multiple actions in one script
3. **Lazy Loading**: Only inject scripts when needed
4. **Result Streaming**: Stream large results (screenshots, text)

## Next Steps

1. Implement core BrowserActionService class
2. Enhance hintDetector.js with required functions
3. Add comprehensive error handling
4. Add logging and debugging capabilities
