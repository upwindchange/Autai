/**
 * Manages WebContentsView lifecycle and operations
 */

import { WebContentsView, BrowserWindow, Rectangle } from "electron";
import { EventEmitter } from "events";
import type {
  IBrowserViewManager,
  AuiViewId,
  AuiView,
  BrowserAction,
  AuiViewResult,
} from "../../shared/types";
import {
  getHintDetectorScript,
  getIndexScript,
} from "../scripts/hintDetectorLoader";

export class BrowserViewManager implements IBrowserViewManager {
  private views = new Map<AuiViewId, WebContentsView>();
  private viewInfo = new Map<AuiViewId, AuiView>();
  private eventEmitter = new EventEmitter();
  private win: BrowserWindow;
  private eventCleanupMap = new Map<AuiViewId, (() => void)[]>();

  constructor(win: BrowserWindow) {
    this.win = win;
  }

  // View lifecycle
  createView(config: {
    viewId: AuiViewId;
    url?: string;
    bounds?: Rectangle;
  }): WebContentsView {
    const { viewId, url = "about:blank", bounds } = config;

    // Check if view already exists
    if (this.views.has(viewId)) {
      throw new Error(`View ${viewId} already exists`);
    }

    // Create WebContentsView
    const webView = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    webView.setBackgroundColor("#00000000");

    // Set up event handlers
    const cleanupHandlers = this.setupEventHandlers(webView, viewId);
    this.eventCleanupMap.set(viewId, cleanupHandlers);

    // Store view and info
    this.views.set(viewId, webView);
    this.viewInfo.set(viewId, {
      id: viewId,
      threadId: "", // Will be set by orchestrator
      url,
      title: "",
      favicon: undefined,
    });

    // Add to window
    this.win.contentView.addChildView(webView);

    // Set bounds and initially hide
    webView.setVisible(false);
    if (bounds) {
      webView.setBounds(bounds);
    } else {
      webView.setBounds({ x: 0, y: 0, width: 1920, height: 1080 });
    }

    // Load URL
    if (url && url !== "about:blank") {
      webView.webContents.loadURL(url).catch((error) => {
        console.error(`Failed to load URL ${url}:`, error);
      });
    }

    // Emit created event
    const info = this.viewInfo.get(viewId)!;
    this.eventEmitter.emit("created", info);

    return webView;
  }

  destroyView(viewId: AuiViewId): void {
    const webView = this.views.get(viewId);
    if (!webView) return;

    try {
      // Clean up event handlers
      const cleanupHandlers = this.eventCleanupMap.get(viewId);
      if (cleanupHandlers) {
        cleanupHandlers.forEach((cleanup) => {
          try {
            cleanup();
          } catch (_) {
            // Ignore cleanup errors
          }
        });
        this.eventCleanupMap.delete(viewId);
      }

      // Clean up WebContents
      if (webView.webContents && !webView.webContents.isDestroyed()) {
        try {
          webView.webContents.stop();
          webView.webContents.removeAllListeners();
          webView.webContents.close({ waitForBeforeUnload: false });
          webView.webContents.forcefullyCrashRenderer();
        } catch (_) {
          // Ignore cleanup errors
        }
      }

      // Remove from window
      if (this.win && !this.win.isDestroyed() && this.win.contentView) {
        try {
          this.win.contentView.removeChildView(webView);
        } catch (error) {
          console.error(`Error removing view from window:`, error);
        }
      }
    } catch (error) {
      console.error(`Error destroying view ${viewId}:`, error);
    }

    // Clean up storage
    this.views.delete(viewId);
    this.viewInfo.delete(viewId);

    // Emit destroyed event
    this.eventEmitter.emit("destroyed", viewId);
  }

  getView(viewId: AuiViewId): WebContentsView | null {
    return this.views.get(viewId) || null;
  }

  getAllViews(): Map<AuiViewId, WebContentsView> {
    return new Map(this.views);
  }

  // Navigation
  async navigateView(viewId: AuiViewId, url: string): Promise<void> {
    const webView = this.views.get(viewId);
    if (!webView) {
      throw new Error(`View ${viewId} not found`);
    }

    await webView.webContents.loadURL(url);
  }

  async goBack(viewId: AuiViewId): Promise<boolean> {
    const webView = this.views.get(viewId);
    if (!webView || !webView.webContents.canGoBack()) {
      return false;
    }

    webView.webContents.goBack();
    return true;
  }

  async goForward(viewId: AuiViewId): Promise<boolean> {
    const webView = this.views.get(viewId);
    if (!webView || !webView.webContents.canGoForward()) {
      return false;
    }

    webView.webContents.goForward();
    return true;
  }

  async reload(viewId: AuiViewId): Promise<void> {
    const webView = this.views.get(viewId);
    if (!webView) {
      throw new Error(`View ${viewId} not found`);
    }

    webView.webContents.reload();
  }

  stop(viewId: AuiViewId): void {
    const webView = this.views.get(viewId);
    if (webView) {
      webView.webContents.stop();
    }
  }

  // Script execution
  async executeScript(viewId: AuiViewId, script: string): Promise<any> {
    const webView = this.views.get(viewId);
    if (!webView) {
      throw new Error(`View ${viewId} not found`);
    }

    return webView.webContents.executeJavaScript(script);
  }

  async executeAction(
    viewId: AuiViewId,
    action: BrowserAction
  ): Promise<AuiViewResult> {
    try {
      const webView = this.views.get(viewId);
      if (!webView) {
        throw new Error(`View ${viewId} not found`);
      }

      switch (action.type) {
        case "navigate":
          await this.navigateView(viewId, action.url);
          return { success: true };

        case "screenshot":
          const buffer = await this.captureScreenshot(viewId);
          return { success: true, data: buffer };

        case "extractText": {
          const selector = action.selector || "*";
          const script = `
            (function() {
              const elements = document.querySelectorAll('${selector}');
              return Array.from(elements).map(el => el.textContent).join('\\n');
            })()
          `;
          const text = await this.executeScript(viewId, script);
          return { success: true, data: text };
        }

        case "click": {
          const script = `
            (function() {
              const element = document.querySelector('${action.selector}');
              if (element) {
                element.click();
                return true;
              }
              return false;
            })()
          `;
          const clicked = await this.executeScript(viewId, script);
          return { success: clicked, data: clicked };
        }

        case "type": {
          const script = `
            (function() {
              const element = document.querySelector('${action.selector}');
              if (element && (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA')) {
                element.value = '${action.text.replace(/'/g, "\\'")}';
                element.dispatchEvent(new Event('input', { bubbles: true }));
                return true;
              }
              return false;
            })()
          `;
          const typed = await this.executeScript(viewId, script);
          return { success: typed, data: typed };
        }

        case "waitFor": {
          const timeout = action.timeout || 5000;
          const script = `
            (function() {
              return new Promise((resolve) => {
                const startTime = Date.now();
                const checkElement = () => {
                  const element = document.querySelector('${action.selector}');
                  if (element) {
                    resolve(true);
                  } else if (Date.now() - startTime > ${timeout}) {
                    resolve(false);
                  } else {
                    setTimeout(checkElement, 100);
                  }
                };
                checkElement();
              });
            })()
          `;
          const found = await this.executeScript(viewId, script);
          return { success: found, data: found };
        }

        default:
          return {
            success: false,
            error: `Unknown action type: ${(action as any).type}`,
          };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  // View properties
  getViewInfo(viewId: AuiViewId): AuiView | null {
    return this.viewInfo.get(viewId) || null;
  }

  updateViewInfo(viewId: AuiViewId, updates: Partial<AuiView>): void {
    const info = this.viewInfo.get(viewId);
    if (!info) return;

    Object.assign(info, updates);
    this.eventEmitter.emit("updated", viewId, updates);
  }

  // Screenshot
  async captureScreenshot(viewId: AuiViewId): Promise<Buffer> {
    const webView = this.views.get(viewId);
    if (!webView) {
      throw new Error(`View ${viewId} not found`);
    }

    const image = await webView.webContents.capturePage();
    return image.toPNG();
  }

  // Event handling
  onViewCreated(callback: (view: AuiView) => void): () => void {
    this.eventEmitter.on("created", callback);
    return () => this.eventEmitter.off("created", callback);
  }

  onViewUpdated(
    callback: (viewId: AuiViewId, updates: Partial<AuiView>) => void
  ): () => void {
    this.eventEmitter.on("updated", callback);
    return () => this.eventEmitter.off("updated", callback);
  }

  onViewDestroyed(callback: (viewId: AuiViewId) => void): () => void {
    this.eventEmitter.on("destroyed", callback);
    return () => this.eventEmitter.off("destroyed", callback);
  }

  // Private methods
  private setupEventHandlers(
    webView: WebContentsView,
    viewId: AuiViewId
  ): (() => void)[] {
    const cleanupHandlers: (() => void)[] = [];

    // Page title updates
    const titleHandler = (_: any, title: string) => {
      this.updateViewInfo(viewId, { title });
    };
    webView.webContents.on("page-title-updated", titleHandler);
    cleanupHandlers.push(() =>
      webView.webContents.off("page-title-updated", titleHandler)
    );

    // Favicon updates
    const faviconHandler = (_: any, favicons: string[]) => {
      if (favicons.length > 0) {
        this.updateViewInfo(viewId, { favicon: favicons[0] });
      }
    };
    webView.webContents.on("page-favicon-updated", faviconHandler);
    cleanupHandlers.push(() =>
      webView.webContents.off("page-favicon-updated", faviconHandler)
    );

    // URL updates
    const urlHandler = (_: any, url: string) => {
      this.updateViewInfo(viewId, { url });
    };
    webView.webContents.on("did-navigate", urlHandler);
    webView.webContents.on("did-navigate-in-page", urlHandler);
    cleanupHandlers.push(
      () => webView.webContents.off("did-navigate", urlHandler),
      () => webView.webContents.off("did-navigate-in-page", urlHandler)
    );

    // Page load completion - inject scripts
    const loadHandler = async () => {
      try {
        // Inject hint detector script
        const hintDetectorScript = getHintDetectorScript();
        await webView.webContents.executeJavaScript(hintDetectorScript);

        // Inject index.js script wrapped in IIFE
        const indexScript = getIndexScript();
        const wrappedIndexScript = `
          (function() {
            window.buildDomTree = ${indexScript};
          })();
        `;
        await webView.webContents.executeJavaScript(wrappedIndexScript);

        console.log(`Successfully injected scripts for view ${viewId}`);
      } catch (error) {
        console.error("Failed to inject scripts:", error);
      }
    };
    webView.webContents.on("did-finish-load", loadHandler);
    cleanupHandlers.push(() =>
      webView.webContents.off("did-finish-load", loadHandler)
    );

    // Console message forwarding
    const consoleHandler = (event: any) => {
      const { level, message, sourceId } = event;
      if (
        message.includes("[HintDetector]") ||
        sourceId.includes("hintDetector")
      ) {
        const logPrefix = `[View ${viewId}]`;
        switch (level) {
          case 0: // info
            console.log(`${logPrefix} ${message}`);
            break;
          case 1: // warning
            console.warn(`${logPrefix} ${message}`);
            break;
          case 2: // error
            console.error(`${logPrefix} ${message}`);
            break;
          default:
            console.log(`${logPrefix} ${message}`);
        }
      }
    };
    webView.webContents.on("console-message", consoleHandler);
    cleanupHandlers.push(() =>
      webView.webContents.off("console-message", consoleHandler)
    );

    // WebContents destroyed handler
    const destroyedHandler = () => {
      console.log(`WebContents for view ${viewId} was destroyed`);
      this.destroyView(viewId);
    };
    webView.webContents.on("destroyed", destroyedHandler);
    cleanupHandlers.push(() => {
      if (!webView.webContents.isDestroyed()) {
        webView.webContents.off("destroyed", destroyedHandler);
      }
    });

    // Navigation error handler
    const failLoadHandler = (
      _: any,
      errorCode: number,
      errorDescription: string,
      validatedURL: string
    ) => {
      console.error(
        `Failed to load ${validatedURL} in view ${viewId}: ${errorDescription} (${errorCode})`
      );
    };
    webView.webContents.on("did-fail-load", failLoadHandler);
    cleanupHandlers.push(() =>
      webView.webContents.off("did-fail-load", failLoadHandler)
    );

    // Crash handler
    const crashHandler = (_: any, details: any) => {
      console.error(`Renderer process crashed for view ${viewId}:`, details);
    };
    webView.webContents.on("render-process-gone", crashHandler);
    cleanupHandlers.push(() =>
      webView.webContents.off("render-process-gone", crashHandler)
    );

    return cleanupHandlers;
  }

  // Cleanup
  destroy(): void {
    // Destroy all views
    Array.from(this.views.keys()).forEach((viewId) => {
      this.destroyView(viewId);
    });

    this.views.clear();
    this.viewInfo.clear();
    this.eventCleanupMap.clear();
    this.eventEmitter.removeAllListeners();
  }
}