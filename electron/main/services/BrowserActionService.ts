import { WebContentsView } from "electron";
import type { StateManager } from "./StateManager";
import type {
  ActionResult,
  InteractableElement,
  ScreenshotOptions,
  BrowserActionOptions,
} from "../../shared/types/browserActions";
import { getHintDetectorScript } from "../scripts/hintDetectorLoader";

export class BrowserActionService {
  private stateManager: StateManager;

  constructor(stateManager: StateManager) {
    this.stateManager = stateManager;
  }

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

  // Navigation Actions
  async navigateTo(
    taskId: string,
    pageId: string,
    url: string
  ): Promise<ActionResult> {
    try {
      const webView = await this.getWebContentsView(taskId, pageId);
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
      const webView = await this.getWebContentsView(taskId, pageId);
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
      const webView = await this.getWebContentsView(taskId, pageId);
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
      const webView = await this.getWebContentsView(taskId, pageId);
      webView.webContents.reload();
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to refresh",
      };
    }
  }

  // Element Interaction Actions
  async clickElement(
    taskId: string,
    pageId: string,
    elementId: number
  ): Promise<ActionResult> {
    try {
      const webView = await this.getWebContentsView(taskId, pageId);
      const result = await webView.webContents.executeJavaScript(`
        window.clickElementById && window.clickElementById(${elementId})
      `);
      return { success: result === true, data: result };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to click element",
      };
    }
  }

  async typeText(
    taskId: string,
    pageId: string,
    elementId: number,
    text: string
  ): Promise<ActionResult> {
    try {
      const webView = await this.getWebContentsView(taskId, pageId);
      const result = await webView.webContents.executeJavaScript(`
        window.typeTextById && window.typeTextById(${elementId}, ${JSON.stringify(text)})
      `);
      return result || { success: false, error: "Failed to type text" };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to type text",
      };
    }
  }

  async pressKey(
    taskId: string,
    pageId: string,
    key: string
  ): Promise<ActionResult> {
    try {
      const webView = await this.getWebContentsView(taskId, pageId);

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
    try {
      const webView = await this.getWebContentsView(taskId, pageId);
      const viewportOnly = options?.viewportOnly ?? true;

      const elements = await webView.webContents.executeJavaScript(`
        window.getInteractableElements && window.getInteractableElements(${viewportOnly})
      `);

      return { success: true, data: elements || [] };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to get page elements",
      };
    }
  }

  async extractText(
    taskId: string,
    pageId: string,
    elementId?: number
  ): Promise<ActionResult> {
    try {
      const webView = await this.getWebContentsView(taskId, pageId);

      if (elementId !== undefined) {
        const script = `window.getElementTextContent && window.getElementTextContent(${elementId})`;
        const text = await webView.webContents.executeJavaScript(script);
        return { success: true, extractedContent: text || "" };
      } else {
        const text = await webView.webContents.executeJavaScript(
          `document.body.innerText`
        );
        return { success: true, extractedContent: text || "" };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to extract text",
      };
    }
  }

  async captureScreenshot(
    taskId: string,
    pageId: string,
    options?: ScreenshotOptions
  ): Promise<ActionResult> {
    try {
      const webView = await this.getWebContentsView(taskId, pageId);
      const image = await webView.webContents.capturePage(options?.rect);
      return { success: true, screenshot: image.toPNG() };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to capture screenshot",
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
    try {
      const webView = await this.getWebContentsView(taskId, pageId);
      const pixels = amount || 500;

      const script = `
        window.scrollBy({
          top: ${direction === "down" ? pixels : -pixels},
          behavior: 'smooth'
        });
        { success: true, scrollY: window.scrollY }
      `;

      const result = await webView.webContents.executeJavaScript(script);
      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to scroll page",
      };
    }
  }

  async scrollToElement(
    taskId: string,
    pageId: string,
    elementId: number
  ): Promise<ActionResult> {
    try {
      const webView = await this.getWebContentsView(taskId, pageId);

      const result = await webView.webContents.executeJavaScript(`
        window.scrollToElementById && window.scrollToElementById(${elementId})
      `);

      return result || { success: false, error: "Failed to scroll to element" };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to scroll to element",
      };
    }
  }

  // Advanced Actions
  async hover(
    taskId: string,
    pageId: string,
    elementId: number
  ): Promise<ActionResult> {
    try {
      const webView = await this.getWebContentsView(taskId, pageId);

      const result = await webView.webContents.executeJavaScript(`
        window.hoverElementById && window.hoverElementById(${elementId})
      `);

      return result || { success: false, error: "Failed to hover element" };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to hover element",
      };
    }
  }

  async waitForSelector(
    taskId: string,
    pageId: string,
    selector: string,
    timeout: number = 5000
  ): Promise<ActionResult> {
    try {
      const webView = await this.getWebContentsView(taskId, pageId);
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
          error instanceof Error ? error.message : "Failed to wait for selector",
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
    try {
      const webView = await this.getWebContentsView(taskId, pageId);

      const result = await webView.webContents.executeJavaScript(`
        window.setElementValue && window.setElementValue(${elementId}, ${JSON.stringify(value)})
      `);

      return result || { success: false, error: "Failed to select option" };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to select option",
      };
    }
  }

  async setCheckbox(
    taskId: string,
    pageId: string,
    elementId: number,
    checked: boolean
  ): Promise<ActionResult> {
    try {
      const webView = await this.getWebContentsView(taskId, pageId);

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

      const result = await webView.webContents.executeJavaScript(script);
      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to set checkbox",
      };
    }
  }

  // Utility Actions
  async executeScript(
    taskId: string,
    pageId: string,
    script: string
  ): Promise<ActionResult> {
    try {
      const webView = await this.getWebContentsView(taskId, pageId);
      const result = await webView.webContents.executeJavaScript(script);
      return { success: true, data: result };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to execute script",
      };
    }
  }

  async getCurrentUrl(
    taskId: string,
    pageId: string
  ): Promise<ActionResult> {
    try {
      const webView = await this.getWebContentsView(taskId, pageId);
      const url = webView.webContents.getURL();
      return { success: true, data: { url } };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to get current URL",
      };
    }
  }

  async getPageTitle(
    taskId: string,
    pageId: string
  ): Promise<ActionResult> {
    try {
      const webView = await this.getWebContentsView(taskId, pageId);
      const title = webView.webContents.getTitle();
      return { success: true, data: { title } };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to get page title",
      };
    }
  }
}