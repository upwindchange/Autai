import type { WebViewService } from ".";
import type { ActionResult, ScreenshotOptions } from "../../shared/types";

/**
 * Service for browser actions and interactions
 * Uses WebViewService for all WebContentsView access
 */
export class BrowserActionService {
  private webViewService: WebViewService;

  constructor(webViewService: WebViewService) {
    this.webViewService = webViewService;
  }

  // Navigation Actions
  async navigateTo(
    taskId: string,
    pageId: string,
    url: string
  ): Promise<ActionResult> {
    try {
      const webView = this.webViewService.requireWebContentsView(
        taskId,
        pageId
      );
      await webView.webContents.loadURL(url);
      return { success: true, data: { url } };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to navigate",
      };
    }
  }

  async goBack(taskId: string, pageId: string): Promise<ActionResult> {
    try {
      const webView = this.webViewService.requireWebContentsView(
        taskId,
        pageId
      );
      if (webView.webContents.canGoBack()) {
        webView.webContents.goBack();
        return { success: true };
      }
      return { success: false, error: "Cannot go back" };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to go back",
      };
    }
  }

  async goForward(taskId: string, pageId: string): Promise<ActionResult> {
    try {
      const webView = this.webViewService.requireWebContentsView(
        taskId,
        pageId
      );
      if (webView.webContents.canGoForward()) {
        webView.webContents.goForward();
        return { success: true };
      }
      return { success: false, error: "Cannot go forward" };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to go forward",
      };
    }
  }

  async refresh(taskId: string, pageId: string): Promise<ActionResult> {
    try {
      const webView = this.webViewService.requireWebContentsView(
        taskId,
        pageId
      );
      webView.webContents.reload();
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to refresh",
      };
    }
  }

  async stop(taskId: string, pageId: string): Promise<ActionResult> {
    try {
      const webView = this.webViewService.requireWebContentsView(
        taskId,
        pageId
      );
      webView.webContents.stop();
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to stop loading",
      };
    }
  }

  // Element Interaction Actions
  async clickElement(
    taskId: string,
    pageId: string,
    elementId: number
  ): Promise<ActionResult> {
    const result = await this.webViewService.executeWindowFunction(
      taskId,
      pageId,
      "clickElementById",
      elementId
    );
    return { success: result.data === true, data: result.data };
  }

  async typeText(
    taskId: string,
    pageId: string,
    elementId: number,
    text: string
  ): Promise<ActionResult> {
    const result = await this.webViewService.executeWindowFunction(
      taskId,
      pageId,
      "typeTextById",
      elementId,
      text
    );
    return result.success
      ? result
      : { success: false, error: "Failed to type text" };
  }

  async pressKey(
    taskId: string,
    pageId: string,
    key: string
  ): Promise<ActionResult> {
    try {
      const webView = this.webViewService.requireWebContentsView(
        taskId,
        pageId
      );

      // Map common keys to Electron accelerator format
      const keyMap: Record<string, string> = {
        enter: "Return",
        tab: "Tab",
        escape: "Escape",
        backspace: "Backspace",
        delete: "Delete",
        space: "Space",
        up: "Up",
        down: "Down",
        left: "Left",
        right: "Right",
      };

      const electronKey = keyMap[key.toLowerCase()] || key;
      webView.webContents.sendInputEvent({
        type: "keyDown",
        keyCode: electronKey,
      });
      webView.webContents.sendInputEvent({
        type: "keyUp",
        keyCode: electronKey,
      });

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to press key",
      };
    }
  }

  // Content Extraction Actions
  async getPageElements(
    taskId: string,
    pageId: string,
    options?: { viewportOnly?: boolean }
  ): Promise<ActionResult> {
    // First ensure hint detector is initialized
    const initResult = await this.webViewService.executeWindowFunction(
      taskId,
      pageId,
      "initializeHintDetector"
    );

    if (!initResult.success) {
      console.warn("[BrowserActionService] Failed to initialize hint detector");
    }

    const viewportOnly = options?.viewportOnly ?? true;
    const result = await this.webViewService.executeWindowFunction(
      taskId,
      pageId,
      "getInteractableElements",
      viewportOnly
    );
    return result.success ? { success: true, data: result.data || [] } : result;
  }

  async showHints(taskId: string, pageId: string): Promise<ActionResult> {
    // First ensure hint detector is initialized
    const initResult = await this.webViewService.executeWindowFunction(
      taskId,
      pageId,
      "initializeHintDetector"
    );

    if (!initResult.success) {
      console.warn("[BrowserActionService] Failed to initialize hint detector");
    }

    const result = await this.webViewService.executeWindowFunction(
      taskId,
      pageId,
      "showHints"
    );
    return result;
  }

  async hideHints(taskId: string, pageId: string): Promise<ActionResult> {
    const result = await this.webViewService.executeWindowFunction(
      taskId,
      pageId,
      "hideHints"
    );
    return result;
  }

  async extractText(
    taskId: string,
    pageId: string,
    elementId?: number
  ): Promise<ActionResult> {
    if (elementId !== undefined) {
      const result = await this.webViewService.executeWindowFunction(
        taskId,
        pageId,
        "getElementTextContent",
        elementId
      );
      return { success: true, extractedContent: String(result.data || "") };
    } else {
      const result = await this.webViewService.executeScript(
        taskId,
        pageId,
        "document.body.innerText"
      );
      return { success: true, extractedContent: String(result.data || "") };
    }
  }

  async captureScreenshot(
    taskId: string,
    pageId: string,
    options?: ScreenshotOptions
  ): Promise<ActionResult> {
    try {
      const webView = this.webViewService.requireWebContentsView(
        taskId,
        pageId
      );
      const image = await webView.webContents.capturePage(options?.rect);
      return { success: true, screenshot: image.toPNG() };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to capture screenshot",
      };
    }
  }

  // Scrolling Actions
  async scrollPage(
    taskId: string,
    pageId: string,
    direction: "up" | "down",
    amount?: number
  ): Promise<ActionResult> {
    const pixels = amount || 500;
    const script = `
      window.scrollBy({
        top: ${direction === "down" ? pixels : -pixels},
        behavior: 'smooth'
      });
      { success: true, scrollY: window.scrollY }
    `;

    return this.webViewService.executeScript(taskId, pageId, script);
  }

  async scrollToElement(
    taskId: string,
    pageId: string,
    elementId: number
  ): Promise<ActionResult> {
    const result = await this.webViewService.executeWindowFunction(
      taskId,
      pageId,
      "scrollToElementById",
      elementId
    );
    return result.success
      ? result
      : { success: false, error: "Failed to scroll to element" };
  }

  // Advanced Actions
  async hover(
    taskId: string,
    pageId: string,
    elementId: number
  ): Promise<ActionResult> {
    const result = await this.webViewService.executeWindowFunction(
      taskId,
      pageId,
      "hoverElementById",
      elementId
    );
    return result.success
      ? result
      : { success: false, error: "Failed to hover element" };
  }

  async waitForSelector(
    taskId: string,
    pageId: string,
    selector: string,
    timeout: number = 5000
  ): Promise<ActionResult> {
    try {
      const webView = this.webViewService.requireWebContentsView(
        taskId,
        pageId
      );
      const startTime = Date.now();

      while (Date.now() - startTime < timeout) {
        const exists = await webView.webContents.executeJavaScript(`
          !!document.querySelector(${JSON.stringify(selector)})
        `);

        if (exists) return { success: true };
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      return { success: false, error: "Selector not found within timeout" };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to wait for selector",
      };
    }
  }

  // Form Handling Actions
  async selectOption(
    taskId: string,
    pageId: string,
    elementId: number,
    value: string
  ): Promise<ActionResult> {
    const result = await this.webViewService.executeWindowFunction(
      taskId,
      pageId,
      "setElementValue",
      elementId,
      value
    );
    return result.success
      ? result
      : { success: false, error: "Failed to select option" };
  }

  async setCheckbox(
    taskId: string,
    pageId: string,
    elementId: number,
    checked: boolean
  ): Promise<ActionResult> {
    const script = `
      (function() {
        const element = window.getElementByHintId && window.getElementByHintId(${elementId});
        if (!element || element.type !== 'checkbox') {
          return { success: false, error: 'Element is not a checkbox' };
        }

        if (element.checked !== ${checked}) {
          return window.clickElementById(${elementId});
        }
        return { success: true, checked: element.checked };
      })()
    `;

    return this.webViewService.executeScript(taskId, pageId, script);
  }

  // Utility Actions
  async executeScript(
    taskId: string,
    pageId: string,
    script: string
  ): Promise<ActionResult> {
    return this.webViewService.executeScript(taskId, pageId, script);
  }

  async getCurrentUrl(taskId: string, pageId: string): Promise<ActionResult> {
    try {
      const webView = this.webViewService.requireWebContentsView(
        taskId,
        pageId
      );
      const url = webView.webContents.getURL();
      return { success: true, data: { url } };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to get current URL",
      };
    }
  }

  async getPageTitle(taskId: string, pageId: string): Promise<ActionResult> {
    try {
      const webView = this.webViewService.requireWebContentsView(
        taskId,
        pageId
      );
      const title = webView.webContents.getTitle();
      return { success: true, data: { title } };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to get page title",
      };
    }
  }
}
