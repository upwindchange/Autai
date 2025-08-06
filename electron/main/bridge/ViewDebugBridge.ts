import { BaseBridge } from "./BaseBridge";
import { ViewControlService, ThreadViewService } from "../services";
import type { ViewId } from "@shared/index";

interface NavigateCommand {
  viewId: ViewId;
  url: string;
}

interface ViewCommand {
  viewId: ViewId;
}

interface SetVisibilityCommand {
  viewId: ViewId;
  isVisible: boolean;
}

interface SetBoundsCommand {
  viewId: ViewId;
  bounds: { x: number; y: number; width: number; height: number };
}

export class ViewDebugBridge extends BaseBridge {
  constructor(private viewControlService: ViewControlService,
    private threadViewService: ThreadViewService
  ) {
    super();
  }

  setupHandlers(): void {
    // Navigate to URL
    this.handle<NavigateCommand, { success: boolean; error?: string }>(
      "debug:threadview:navigateTo",
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
      "debug:threadview:refresh",
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
      "debug:threadview:goBack",
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
      "debug:threadview:goForward",
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

    // Set view visibility
    this.handle<SetVisibilityCommand, { success: boolean; error?: string }>(
      "debug:threadview:setVisibility",
      async (_, command) => {
        try {
          await this.threadViewService.setFrontendVisibility(command.viewId, command.isVisible);
          return { success: true };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          };
        }
      }
    );

    // Set view bounds
    this.handle<SetBoundsCommand, { success: boolean; error?: string }>(
      "debug:threadview:setBounds",
      async (_, command) => {
        try {
          await this.threadViewService.setBounds(command.viewId, command.bounds);
          return { success: true };
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