import { BaseBridge } from "@/bridges/BaseBridge";
import { SessionTabService } from "@/services";
import type { SessionId, TabId } from "@shared";
import { Rectangle } from "electron";

export class SessionTabBridge extends BaseBridge {
	constructor(private sessionTabService: SessionTabService) {
		super();
	}

	setupHandlers(): void {
		// Thread lifecycle handlers (one-way, no response needed)
		this.on<SessionId>("sessiontab:created", async (_, threadId) => {
			await this.sessionTabService.createSession(threadId);
		});

		this.on<SessionId>("sessiontab:switched", async (_, threadId) => {
			await this.sessionTabService.switchSession(threadId);
		});

		this.on<SessionId>("sessiontab:deleted", async (_, threadId) => {
			await this.sessionTabService.deleteSession(threadId);
		});

		// Thread query handlers (need response)
		this.handle<SessionId, { success: boolean; data?: TabId | null }>(
			"sessiontab:getActiveTab",
			async (_, threadId) => {
				const viewId = this.sessionTabService.getActiveTabForSession(threadId);
				return { success: true, data: viewId };
			},
		);

		// View visibility handlers (one-way, no response needed)
		this.on<{ viewId: TabId; isVisible: boolean }>(
			"sessiontab:setVisibility",
			async (_, { isVisible }) => {
				await this.sessionTabService.setFrontendVisibility(isVisible);
			},
		);

		// View bounds handlers (one-way, no response needed)
		this.on<{ bounds: Rectangle }>(
			"sessiontab:setBounds",
			async (_, { bounds }) => {
				await this.sessionTabService.setBounds(bounds);
			},
		);
	}
}
