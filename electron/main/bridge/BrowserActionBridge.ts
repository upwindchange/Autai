import { BrowserWindow } from "electron";
import { BaseBridge } from "./BaseBridge";
import { BrowserActionService, type WebViewService } from "../services";

/**
 * Bridge for browser actions and interactions
 * Exposes BrowserActionService functionality to the renderer process
 */
export class BrowserActionBridge extends BaseBridge {
  private browserActionService: BrowserActionService;

  constructor(webViewService: WebViewService) {
    super();
    this.browserActionService = new BrowserActionService(webViewService);
  }

  setupHandlers(): void {
    // Navigation Actions
    this.handle("app:navigateTo", async (_event, command) => {
      return this.browserActionService.navigateTo(
        command.taskId,
        command.pageId,
        command.url
      );
    });

    this.handle("app:goBack", async (_event, command) => {
      return this.browserActionService.goBack(command.taskId, command.pageId);
    });

    this.handle("app:goForward", async (_event, command) => {
      return this.browserActionService.goForward(
        command.taskId,
        command.pageId
      );
    });

    this.handle("app:refresh", async (_event, command) => {
      return this.browserActionService.refresh(command.taskId, command.pageId);
    });

    this.handle("app:stop", async (_event, command) => {
      return this.browserActionService.stop(command.taskId, command.pageId);
    });

    // Element Interaction Actions
    this.handle("app:clickElement", async (_event, command) => {
      return this.browserActionService.clickElement(
        command.taskId,
        command.pageId,
        command.elementId
      );
    });

    this.handle("app:typeText", async (_event, command) => {
      return this.browserActionService.typeText(
        command.taskId,
        command.pageId,
        command.elementId,
        command.text
      );
    });

    this.handle("app:pressKey", async (_event, command) => {
      return this.browserActionService.pressKey(
        command.taskId,
        command.pageId,
        command.key
      );
    });

    // Content Extraction Actions
    this.handle("app:getPageElements", async (_event, command) => {
      return this.browserActionService.getPageElements(
        command.taskId,
        command.pageId,
        command.options
      );
    });

    this.handle("app:showHints", async (_event, command) => {
      return this.browserActionService.showHints(
        command.taskId,
        command.pageId
      );
    });

    this.handle("app:hideHints", async (_event, command) => {
      return this.browserActionService.hideHints(
        command.taskId,
        command.pageId
      );
    });

    this.handle("app:extractText", async (_event, command) => {
      return this.browserActionService.extractText(
        command.taskId,
        command.pageId,
        command.elementId
      );
    });

    this.handle("app:captureScreenshot", async (_event, command) => {
      return this.browserActionService.captureScreenshot(
        command.taskId,
        command.pageId,
        command.options
      );
    });

    // Scrolling Actions
    this.handle("app:scrollPage", async (_event, command) => {
      return this.browserActionService.scrollPage(
        command.taskId,
        command.pageId,
        command.direction,
        command.amount
      );
    });

    this.handle("app:scrollToElement", async (_event, command) => {
      return this.browserActionService.scrollToElement(
        command.taskId,
        command.pageId,
        command.elementId
      );
    });

    // Advanced Actions
    this.handle("app:hover", async (_event, command) => {
      return this.browserActionService.hover(
        command.taskId,
        command.pageId,
        command.elementId
      );
    });

    this.handle("app:waitForSelector", async (_event, command) => {
      return this.browserActionService.waitForSelector(
        command.taskId,
        command.pageId,
        command.selector,
        command.timeout
      );
    });

    // Form Handling Actions
    this.handle("app:selectOption", async (_event, command) => {
      return this.browserActionService.selectOption(
        command.taskId,
        command.pageId,
        command.elementId,
        command.value
      );
    });

    this.handle("app:setCheckbox", async (_event, command) => {
      return this.browserActionService.setCheckbox(
        command.taskId,
        command.pageId,
        command.elementId,
        command.checked
      );
    });

    // Utility Actions
    this.handle("app:executeScript", async (_event, command) => {
      return this.browserActionService.executeScript(
        command.taskId,
        command.pageId,
        command.script
      );
    });

    this.handle("app:getCurrentUrl", async (_event, command) => {
      return this.browserActionService.getCurrentUrl(
        command.taskId,
        command.pageId
      );
    });

    this.handle("app:getPageTitle", async (_event, command) => {
      return this.browserActionService.getPageTitle(
        command.taskId,
        command.pageId
      );
    });
  }
}
