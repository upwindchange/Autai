import type { TabId } from "@shared";
import { SessionTabService } from "@/services";
import log from "electron-log/main";

export class ViewControlService {
	private static instance: ViewControlService | null = null;
	private sessionTabService: SessionTabService; // We'll inject this dependency
	private logger = log.scope("ViewControlService");

	private constructor(sessionTabService: SessionTabService) {
		this.sessionTabService = sessionTabService;
		this.logger.info("ViewControlService initialized");
	}

	static getInstance(
		sessionTabService?: SessionTabService,
	): ViewControlService {
		if (!ViewControlService.instance) {
			if (!sessionTabService) {
				throw new Error(
					"SessionTabService required for first ViewControlService initialization",
				);
			}
			ViewControlService.instance = new ViewControlService(sessionTabService);
		}
		return ViewControlService.instance;
	}

	static hasInstance(): boolean {
		return ViewControlService.instance !== null;
	}

	static destroyInstance(): void {
		if (ViewControlService.instance) {
			ViewControlService.instance.logger.info(
				"Destroying ViewControlService instance",
			);
			ViewControlService.instance = null;
		}
	}

	/**
	 * Navigates a view to a URL
	 */
	async navigateTo(viewId: TabId, url: string): Promise<string> {
		this.logger.debug("Navigating view", { viewId, url });
		const view = this.sessionTabService.getTab(viewId);
		if (!view) {
			const error = `View ${viewId} not found`;
			this.logger.error("Navigation failed - view not found", { viewId, url });
			throw new Error(error);
		}

		this.sessionTabService.updateTabTimestamp(viewId);
		await view.webContents.loadURL(url);
		this.logger.info("Navigation successful", { viewId, url });
		return `Successfully navigated view ${viewId} to ${url}`;
	}

	/**
	 * Refreshes the current page
	 */
	async refresh(viewId: TabId): Promise<string> {
		this.logger.debug("Refreshing view", { viewId });
		const view = this.sessionTabService.getTab(viewId);
		if (!view) {
			const error = `View ${viewId} not found`;
			this.logger.error("Refresh failed - view not found", { viewId });
			throw new Error(error);
		}

		this.sessionTabService.updateTabTimestamp(viewId);
		view.webContents.reload();
		this.logger.info("Refresh successful", { viewId });
		return `Successfully refreshed view ${viewId}`;
	}

	/**
	 * Goes back in navigation history
	 */
	async goBack(viewId: TabId): Promise<string> {
		this.logger.debug("Going back in view", { viewId });
		const view = this.sessionTabService.getTab(viewId);
		if (!view) {
			const error = `View ${viewId} not found`;
			this.logger.error("Go back failed - view not found", { viewId });
			throw new Error(error);
		}

		if (view.webContents.navigationHistory.canGoBack()) {
			this.sessionTabService.updateTabTimestamp(viewId);
			view.webContents.navigationHistory.goBack();
			this.logger.info("Go back successful", { viewId });
			return `Successfully went back in view ${viewId}`;
		}

		this.logger.warn("Cannot go back - no history", { viewId });
		return `Cannot go back in view ${viewId} - no back history available`;
	}

	/**
	 * Goes forward in navigation history
	 */
	async goForward(viewId: TabId): Promise<string> {
		this.logger.debug("Going forward in view", { viewId });
		const view = this.sessionTabService.getTab(viewId);
		if (!view) {
			const error = `View ${viewId} not found`;
			this.logger.error("Go forward failed - view not found", { viewId });
			throw new Error(error);
		}

		if (view.webContents.navigationHistory.canGoForward()) {
			this.sessionTabService.updateTabTimestamp(viewId);
			view.webContents.navigationHistory.goForward();
			this.logger.info("Go forward successful", { viewId });
			return `Successfully went forward in view ${viewId}`;
		}

		this.logger.warn("Cannot go forward - no history", { viewId });
		return `Cannot go forward in view ${viewId} - no forward history available`;
	}
}
