import { BaseBridge } from "./BaseBridge";
import { ViewControlService } from "../services/ViewControlService";
import type { ViewId } from "@shared/index";

interface NavigateCommand {
  viewId: ViewId;
  url: string;
}

interface ViewCommand {
  viewId: ViewId;
}

export class ViewControlBridge extends BaseBridge {
  constructor(private viewControlService: ViewControlService) {
    super();
  }

  setupHandlers(): void {
    // Navigate to URL
    this.handle<NavigateCommand, { success: boolean; error?: string }>(
      "view:navigateTo",
      async (_, command) => {
        try {
          await this.viewControlService.navigateTo(command.viewId, command.url);
          return { success: true };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          };
        }
      }
    );

    // Refresh current page
    this.handle<ViewCommand, { success: boolean; error?: string }>(
      "view:refresh",
      async (_, command) => {
        try {
          await this.viewControlService.refresh(command.viewId);
          return { success: true };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          };
        }
      }
    );

    // Go back in navigation history
    this.handle<ViewCommand, { success: boolean; data?: boolean; error?: string }>(
      "view:goBack",
      async (_, command) => {
        try {
          const result = await this.viewControlService.goBack(command.viewId);
          return { success: true, data: result };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          };
        }
      }
    );

    // Go forward in navigation history
    this.handle<ViewCommand, { success: boolean; data?: boolean; error?: string }>(
      "view:goForward",
      async (_, command) => {
        try {
          const result = await this.viewControlService.goForward(command.viewId);
          return { success: true, data: result };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          };
        }
      }
    );
  }
}