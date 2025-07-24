/**
 * Handles AuiThread-related IPC operations
 */

import { IpcMainInvokeEvent } from "electron";
import { BaseBridge } from "./BaseBridge";
import type {
  IViewOrchestrator,
  IAuiThreadViewManager,
  CreateAuiViewCommand,
  NavigateAuiViewCommand,
  ExecuteAuiViewCommand,
  SetAuiViewBoundsCommand,
  SetAuiViewVisibilityCommand,
  BrowserAction,
  AuiViewResult,
  AuiThreadEvent,
  AuiViewEvent,
} from "../../shared/types";

export class AuiThreadBridge extends BaseBridge {
  private orchestrator: IViewOrchestrator;
  private threadViewManager: IAuiThreadViewManager;

  constructor(
    orchestrator: IViewOrchestrator,
    threadViewManager: IAuiThreadViewManager
  ) {
    super();
    this.orchestrator = orchestrator;
    this.threadViewManager = threadViewManager;
  }

  setupHandlers(): void {
    // Thread lifecycle handlers
    this.handle(
      "auiThread:created",
      async (_event: IpcMainInvokeEvent, threadId: string) => {
        this.threadViewManager.onThreadCreated(threadId);
        return { success: true };
      }
    );

    this.handle(
      "auiThread:switched",
      async (_event: IpcMainInvokeEvent, threadId: string) => {
        this.threadViewManager.onThreadSwitched(threadId);
        return { success: true };
      }
    );

    this.handle(
      "auiThread:deleted",
      async (_event: IpcMainInvokeEvent, threadId: string) => {
        this.threadViewManager.onThreadDeleted(threadId);
        return { success: true };
      }
    );

    // View operations
    this.handle(
      "auiView:create",
      async (_event: IpcMainInvokeEvent, command: CreateAuiViewCommand) => {
        try {
          const viewId = await this.orchestrator.createViewForThread(
            command.threadId,
            command.target
          );
          
          // Navigate if URL provided
          if (command.url) {
            await this.orchestrator.navigateView(viewId, command.url);
          }
          
          return { success: true, data: viewId };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Failed to create view",
          };
        }
      }
    );

    this.handle(
      "auiView:navigate",
      async (_event: IpcMainInvokeEvent, command: NavigateAuiViewCommand) => {
        try {
          await this.orchestrator.navigateView(command.viewId, command.url);
          return { success: true };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Failed to navigate",
          };
        }
      }
    );

    this.handle(
      "auiView:execute",
      async (_event: IpcMainInvokeEvent, command: ExecuteAuiViewCommand) => {
        try {
          const result = await this.orchestrator.executeViewAction(
            command.viewId,
            { type: "extractText" } as BrowserAction // Default action for script execution
          );
          return result;
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Failed to execute script",
          };
        }
      }
    );

    this.handle(
      "auiView:executeAction",
      async (
        _event: IpcMainInvokeEvent,
        command: { viewId: string; action: BrowserAction }
      ) => {
        try {
          return await this.orchestrator.executeViewAction(
            command.viewId,
            command.action
          );
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Failed to execute action",
          };
        }
      }
    );

    this.handle(
      "auiView:close",
      async (_event: IpcMainInvokeEvent, viewId: string) => {
        this.orchestrator.closeView(viewId);
        return { success: true };
      }
    );

    // View state management
    this.handle(
      "auiView:setBounds",
      async (_event: IpcMainInvokeEvent, command: SetAuiViewBoundsCommand) => {
        this.orchestrator.setViewBounds(command.viewId, command.bounds);
        return { success: true };
      }
    );

    this.handle(
      "auiView:setVisibility",
      async (_event: IpcMainInvokeEvent, command: SetAuiViewVisibilityCommand) => {
        this.orchestrator.setViewVisibility(command.viewId, command.isVisible);
        return { success: true };
      }
    );

    this.handle(
      "auiView:setActive",
      async (_event: IpcMainInvokeEvent, viewId: string | null) => {
        this.orchestrator.setActiveView(viewId);
        return { success: true };
      }
    );

    // Query handlers
    this.handle(
      "auiThread:getViews",
      async (_event: IpcMainInvokeEvent, threadId: string) => {
        const views = this.orchestrator.getAllViewsForThread(threadId);
        return { success: true, data: views };
      }
    );

    this.handle(
      "auiThread:getActiveView",
      async (_event: IpcMainInvokeEvent, threadId: string) => {
        const viewId = this.orchestrator.getActiveViewForThread(threadId);
        return { success: true, data: viewId };
      }
    );

    this.handle(
      "auiThread:getState",
      async (_event: IpcMainInvokeEvent, threadId: string) => {
        const state = this.threadViewManager.getThreadViewState(threadId);
        return { success: true, data: state };
      }
    );

    this.handle(
      "auiView:getMetadata",
      async (_event: IpcMainInvokeEvent, viewId: string) => {
        const metadata = this.orchestrator.getViewMetadata(viewId);
        return { success: true, data: metadata };
      }
    );

    // Set up event forwarding
    this.setupEventForwarding();
  }

  private setupEventForwarding(): void {
    // Forward thread events to renderer
    this.threadViewManager.subscribeToThreadEvents((event: AuiThreadEvent) => {
      this.sendToAllWindows("auiThread:event", event);
    });

    // Forward view events to renderer
    this.threadViewManager.subscribeToViewEvents((event: AuiViewEvent) => {
      this.sendToAllWindows("auiView:event", event);
    });
  }

  /**
   * Send event to all windows
   */
  private sendToAllWindows(channel: string, ...args: any[]): void {
    const { BrowserWindow } = require("electron");
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send(channel, ...args);
      }
    });
  }

  destroy(): void {
    super.destroy();
  }
}