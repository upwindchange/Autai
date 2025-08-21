import { BaseBridge } from "./BaseBridge";
import { ThreadViewService } from "../services/ThreadViewService";
import type { ThreadId, ViewId } from "@shared/index";
import { Rectangle } from "electron";

export class ThreadViewBridge extends BaseBridge {
  constructor(private threadViewService: ThreadViewService) {
    super();
  }

  setupHandlers(): void {
    // Thread lifecycle handlers (one-way, no response needed)
    this.on<ThreadId>("threadview:created", async (_, threadId) => {
      await this.threadViewService.createThread(threadId);
    });

    this.on<ThreadId>("threadview:switched", async (_, threadId) => {
      await this.threadViewService.switchThread(threadId);
    });

    this.on<ThreadId>("threadview:deleted", async (_, threadId) => {
      await this.threadViewService.deleteThread(threadId);
    });

    // Thread query handlers (need response)
    this.handle<ThreadId, { success: boolean; data?: ViewId | null }>(
      "threadview:getActiveView",
      async (_, threadId) => {
        const viewId = this.threadViewService.getActiveViewForThread(threadId);
        return { success: true, data: viewId };
      }
    );

    // View visibility handlers (one-way, no response needed)
    this.on<{ viewId: ViewId; isVisible: boolean }>(
      "threadview:setVisibility",
      async (_, { isVisible }) => {
        await this.threadViewService.setFrontendVisibility(isVisible);
      }
    );

    // View bounds handlers (one-way, no response needed)
    this.on<{ bounds: Rectangle }>(
      "threadview:setBounds",
      async (_, { bounds }) => {
        await this.threadViewService.setBounds(bounds);
      }
    );
  }
}
