import { IpcMainInvokeEvent } from "electron";
import { BaseBridge } from "./BaseBridge";
import { ThreadViewService } from "../services/ThreadViewService";
import type { ThreadId, ViewId } from "@shared/types";

export class ThreadViewBridge extends BaseBridge {
  constructor(private threadViewService: ThreadViewService) {
    super();
  }

  setupHandlers(): void {
    // Thread lifecycle handlers
    this.handle<ThreadId, { success: boolean }>(
      "thread:created",
      async (_, threadId) => {
        await this.threadViewService.createThread(threadId);
        return { success: true };
      }
    );

    this.handle<ThreadId, { success: boolean }>(
      "thread:switched",
      async (_, threadId) => {
        await this.threadViewService.switchThread(threadId);
        return { success: true };
      }
    );

    this.handle<ThreadId, { success: boolean }>(
      "thread:deleted",
      async (_, threadId) => {
        await this.threadViewService.deleteThread(threadId);
        return { success: true };
      }
    );

    // Thread query handlers
    this.handle<ThreadId, { success: boolean; data?: ViewId | null }>(
      "thread:getActiveView",
      async (_, threadId) => {
        const viewId = this.threadViewService.getActiveViewForThread(threadId);
        return { success: true, data: viewId };
      }
    );

    // View visibility handlers
    this.handle<{ viewId: ViewId; isVisible: boolean }, { success: boolean }>(
      "view:setVisibility",
      async (_, { viewId, isVisible }) => {
        await this.threadViewService.setFrontendVisibility(viewId, isVisible);
        return { success: true };
      }
    );

    // View bounds handlers
    this.handle<{ viewId: ViewId; bounds: { x: number; y: number; width: number; height: number } }, { success: boolean }>(
      "view:setBounds",
      async (_, { viewId, bounds }) => {
        await this.threadViewService.setBounds(viewId, bounds);
        return { success: true };
      }
    );
  }
}