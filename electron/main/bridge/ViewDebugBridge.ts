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
    // Navigate to URL (one-way, no response needed)
    this.on<NavigateCommand>(
      "debug:threadview:navigateTo",
      async (_, command) => {
        try {
          await this.viewControlService.navigateTo(command.viewId, command.url);
        } catch (error) {
          console.error("Navigation failed:", error);
        }
      }
    );

    // Refresh current page (one-way, no response needed)
    this.on<ViewCommand>(
      "debug:threadview:refresh",
      async (_, command) => {
        try {
          await this.viewControlService.refresh(command.viewId);
        } catch (error) {
          console.error("Refresh failed:", error);
        }
      }
    );

    // Go back in navigation history (one-way, no response needed)
    this.on<ViewCommand>(
      "debug:threadview:goBack",
      async (_, command) => {
        try {
          await this.viewControlService.goBack(command.viewId);
        } catch (error) {
          console.error("Go back failed:", error);
        }
      }
    );

    // Go forward in navigation history (one-way, no response needed)
    this.on<ViewCommand>(
      "debug:threadview:goForward",
      async (_, command) => {
        try {
          await this.viewControlService.goForward(command.viewId);
        } catch (error) {
          console.error("Go forward failed:", error);
        }
      }
    );

    // Set view visibility (one-way, no response needed)
    this.on<SetVisibilityCommand>(
      "debug:threadview:setVisibility",
      async (_, command) => {
        try {
          await this.threadViewService.setFrontendVisibility(command.viewId, command.isVisible);
        } catch (error) {
          console.error("Set visibility failed:", error);
        }
      }
    );

    // Set view bounds (one-way, no response needed)
    this.on<SetBoundsCommand>(
      "debug:threadview:setBounds",
      async (_, command) => {
        try {
          await this.threadViewService.setBounds(command.viewId, command.bounds);
        } catch (error) {
          console.error("Set bounds failed:", error);
        }
      }
    );
  }
}