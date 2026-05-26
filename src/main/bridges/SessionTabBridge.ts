import { BaseBridge } from "@/bridges/BaseBridge";
import { SessionTabService } from "@/services";
import type { SessionId, TabId } from "@shared";
import { Rectangle } from "electron";

export class SessionTabBridge extends BaseBridge {
  constructor(private sessionTabService: SessionTabService) {
    super();
  }

  setupHandlers(): void {
    // Session activation — ensures session exists and makes it active
    this.on<SessionId>("sessiontab:activate", async (_, sessionId) => {
      await this.sessionTabService.activateSession(sessionId);
    });

    // Session deletion
    this.on<SessionId>("sessiontab:deleted", async (_, sessionId) => {
      await this.sessionTabService.deleteSession(sessionId);
    });

    // Thread query handlers (need response)
    this.handle<SessionId, { success: boolean; data?: TabId | null }>(
      "sessiontab:getActiveTab",
      async (_, threadId) => {
        const viewId = this.sessionTabService.getActiveTabForSession(threadId);
        return { success: true, data: viewId };
      },
    );

    // View visibility (one-way, no response needed)
    this.on<{ isVisible: boolean }>(
      "sessiontab:setVisibility",
      async (_, { isVisible }) => {
        await this.sessionTabService.setFrontendVisibility(isVisible);
      },
    );

    // View bounds (one-way, no response needed)
    this.on<{ bounds: Rectangle }>(
      "sessiontab:setBounds",
      async (_, { bounds }) => {
        await this.sessionTabService.setBounds(bounds);
      },
    );
  }
}
