import type { TabId } from "@shared";
import { SessionTabService } from "@/services";
import log from "electron-log/main";

export class TabControlService {
	private static instance: TabControlService | null = null;
	private sessionTabService: SessionTabService; // We'll inject this dependency
	private logger = log.scope("TabControlService");

	private constructor(sessionTabService: SessionTabService) {
		this.sessionTabService = sessionTabService;
		this.logger.info("TabControlService initialized");
	}

	static getInstance(sessionTabService?: SessionTabService): TabControlService {
		if (!TabControlService.instance) {
			if (!sessionTabService) {
				throw new Error(
					"SessionTabService required for first TabControlService initialization",
				);
			}
			TabControlService.instance = new TabControlService(sessionTabService);
		}
		return TabControlService.instance;
	}

	static hasInstance(): boolean {
		return TabControlService.instance !== null;
	}

	static destroyInstance(): void {
		if (TabControlService.instance) {
			TabControlService.instance.logger.info(
				"Destroying TabControlService instance",
			);
			TabControlService.instance = null;
		}
	}

	/**
	 * Navigates a tab to a URL
	 */
	async navigateTo(TabId: TabId, url: string): Promise<string> {
		this.logger.debug("Navigating tab", { TabId, url });
		const tab = this.sessionTabService.getTab(TabId);
		if (!tab) {
			const error = `Tab ${TabId} not found`;
			this.logger.error("Navigation failed - tab not found", {
				TabId,
				url,
			});
			throw new Error(error);
		}

		this.sessionTabService.updateTabTimestamp(TabId);
		await tab.webContents.loadURL(url);
		this.logger.info("Navigation successful", { TabId, url });
		return `Successfully navigated tab ${TabId} to ${url}`;
	}

	/**
	 * Refreshes the current page
	 */
	async refresh(TabId: TabId): Promise<string> {
		this.logger.debug("Refreshing tab", { TabId });
		const tab = this.sessionTabService.getTab(TabId);
		if (!tab) {
			const error = `Tab ${TabId} not found`;
			this.logger.error("Refresh failed - tab not found", { TabId });
			throw new Error(error);
		}

		this.sessionTabService.updateTabTimestamp(TabId);
		tab.webContents.reload();
		this.logger.info("Refresh successful", { TabId });
		return `Successfully refreshed tab ${TabId}`;
	}

	/**
	 * Goes back in navigation history
	 */
	async goBack(TabId: TabId): Promise<string> {
		this.logger.debug("Going back in tab", { TabId });
		const tab = this.sessionTabService.getTab(TabId);
		if (!tab) {
			const error = `Tab ${TabId} not found`;
			this.logger.error("Go back failed - tab not found", { TabId });
			throw new Error(error);
		}

		if (tab.webContents.navigationHistory.canGoBack()) {
			this.sessionTabService.updateTabTimestamp(TabId);
			tab.webContents.navigationHistory.goBack();
			this.logger.info("Go back successful", { TabId });
			return `Successfully went back in tab ${TabId}`;
		}

		this.logger.warn("Cannot go back - no history", { TabId });
		return `Cannot go back in tab ${TabId} - no back history available`;
	}

	/**
	 * Goes forward in navigation history
	 */
	async goForward(TabId: TabId): Promise<string> {
		this.logger.debug("Going forward in tab", { TabId });
		const tab = this.sessionTabService.getTab(TabId);
		if (!tab) {
			const error = `Tab ${TabId} not found`;
			this.logger.error("Go forward failed - tab not found", {
				TabId,
			});
			throw new Error(error);
		}

		if (tab.webContents.navigationHistory.canGoForward()) {
			this.sessionTabService.updateTabTimestamp(TabId);
			tab.webContents.navigationHistory.goForward();
			this.logger.info("Go forward successful", { TabId });
			return `Successfully went forward in tab ${TabId}`;
		}

		this.logger.warn("Cannot go forward - no history", { TabId });
		return `Cannot go forward in tab ${TabId} - no forward history available`;
	}
}
