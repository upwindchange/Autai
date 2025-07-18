import { IpcMainInvokeEvent } from "electron";
import { BaseBridge } from "./BaseBridge";
import type {
  NavigateCommand,
  NavigationControlCommand,
} from "../../shared/types/index";
import {
  type StateManager,
  NavigationService,
  type WebViewService,
} from "../services";

/**
 * Handles navigation-related IPC operations
 */
export class NavigationBridge extends BaseBridge {
  private navigationService: NavigationService;

  constructor(stateManager: StateManager, webViewService: WebViewService) {
    super();
    this.navigationService = new NavigationService(
      stateManager,
      webViewService
    );
  }

  setupHandlers(): void {
    // Navigate to URL
    this.handle(
      "app:navigate",
      async (_event: IpcMainInvokeEvent, command: NavigateCommand) => {
        return this.navigationService.navigateToUrl(
          command.taskId,
          command.pageId,
          command.url
        );
      }
    );

    // Navigation controls
    this.handle(
      "app:navigationControl",
      async (_event: IpcMainInvokeEvent, command: NavigationControlCommand) => {
        switch (command.action) {
          case "back":
            return this.navigationService.goBack(
              command.taskId,
              command.pageId
            );
          case "forward":
            return this.navigationService.goForward(
              command.taskId,
              command.pageId
            );
          case "reload":
            return this.navigationService.refresh(
              command.taskId,
              command.pageId
            );
          case "stop":
            return this.navigationService.stop(command.taskId, command.pageId);
          default:
            return { success: false, error: "Invalid action" };
        }
      }
    );
  }
}
