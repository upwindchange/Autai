import { WebContentsView, BrowserWindow, Rectangle } from "electron";
import { EventEmitter } from "events";
import type { SessionId, TabId, sessionTabState } from "@shared";
import { DOMService } from "./dom";
import { ElementInteractionService } from "./interaction/ElementInteractionService";
import log from "electron-log/main";

interface TabMetadata {
	id: TabId;
	sessionId: SessionId;
	backendVisibility: boolean;
	timestamp: number;
}

interface CreateTabOptions {
	sessionId: SessionId;
	bounds?: Rectangle;
	url?: string;
}

export class SessionTabService extends EventEmitter {
	private static instance: SessionTabService | null = null;
	private tabs = new Map<TabId, WebContentsView>();
	private tabMetadata = new Map<TabId, TabMetadata>();
	private domServices = new Map<TabId, DOMService>();
	private interactionServices = new Map<TabId, ElementInteractionService>();
	private tabBounds: Rectangle = { x: 0, y: 0, width: 1920, height: 1080 };
	private sessionStates = new Map<SessionId, sessionTabState>();
	private activeTab: WebContentsView | null = null;
	private frontendVisibility: boolean = false;
	private win: BrowserWindow;
	private logger = log.scope("SessionTabService");
	public activeSessionId: SessionId | null = null;

	private constructor(win: BrowserWindow) {
		super();
		this.win = win;
	}

	static getInstance(win?: BrowserWindow): SessionTabService {
		if (!SessionTabService.instance) {
			if (!win) {
				throw new Error(
					"BrowserWindow instance required for first initialization",
				);
			}
			SessionTabService.instance = new SessionTabService(win);
		}
		return SessionTabService.instance;
	}

	static destroyInstance(): void {
		if (SessionTabService.instance) {
			SessionTabService.instance.removeAllListeners();
			SessionTabService.instance = null;
		}
	}

	// ===================
	// SESSION LIFECYCLE
	// ===================

	async createSession(sessionId: SessionId): Promise<void> {
		if (this.sessionStates.has(sessionId)) {
			this.logger.info(`Session ${sessionId} already exists, switching to it`);
			this.activeSessionId = sessionId;
			return;
		}

		// Initialize session state
		this.sessionStates.set(sessionId, {
			sessionId: sessionId,
			tabIds: [],
			activeTabId: null,
		});

		this.activeSessionId = sessionId;
		this.logger.info(`Session ${sessionId} created`);

		// Create initial tab and set as active tab for the session
		const tabId = await this.createTab({ sessionId: sessionId });
		const state = this.sessionStates.get(sessionId)!;
		state.activeTabId = tabId;
		this.activeTab = this.tabs.get(tabId) || null;
		this.logger.info(`Initial tab ${tabId} created for session ${sessionId}`);
	}

	async switchSession(sessionId: SessionId): Promise<void> {
		this.logger.info(
			`Switching from session ${this.activeSessionId} to ${sessionId}`,
		);

		// Hide all tabs from current session
		if (this.activeSessionId) {
			await this.hideSessionTabs(this.activeSessionId);
		}

		this.activeSessionId = sessionId;
		this.logger.debug(`Active session set to ${sessionId}`);

		// Show active tab of new session (respecting visibility rules)
		const activeTabId = this.getActiveTabForSession(sessionId);
		if (activeTabId) {
			this.activeTab = this.tabs.get(activeTabId) || null;
			this.logger.debug(
				`Active tab for session ${sessionId} is ${activeTabId}`,
			);
			await this.setBackendVisibility(activeTabId, true);
		} else {
			// No active tab for this session, clear the active tab reference
			this.activeTab = null;
			this.logger.debug(`No active tab found for session ${sessionId}`);
		}
	}

	async deleteSession(sessionId: SessionId): Promise<void> {
		const state = this.sessionStates.get(sessionId);
		if (!state) return;

		// Destroy all tabs for this session
		for (const tabId of state.tabIds) {
			await this.destroyTab(tabId);
		}

		this.sessionStates.delete(sessionId);

		// Clear active session if it was deleted
		if (this.activeSessionId === sessionId) {
			// Get the first available session as the new active session
			const firstState = this.sessionStates.values().next().value;
			this.activeSessionId = firstState?.sessionId || null;
			if (firstState?.activeTabId) {
				this.activeTab = this.tabs.get(firstState.activeTabId) || null;
			} else {
				this.activeTab = null;
			}
		}
	}

	// ===================
	// TAB LIFECYCLE
	// ===================

	async createTab(options: CreateTabOptions): Promise<TabId> {
		const {
			sessionId,
			bounds,
			url,
		} = options;
		const tabId = `tab-${Date.now()}-${Math.random()
			.toString(36)
			.substring(2, 11)}`;

		// Create tab
		const tab = new WebContentsView({
			webPreferences: {
				contextIsolation: true,
				nodeIntegration: false,
			},
		});

		tab.setBackgroundColor("#00000000");

		// Store tab and metadata
		this.tabs.set(tabId, tab);
		this.tabMetadata.set(tabId, {
			id: tabId,
			sessionId,
			backendVisibility: true, // Default to visible from backend
			timestamp: Date.now(),
		});

		// Create and store DomService for this tab
		const domService = new DOMService(tab.webContents);
		this.domServices.set(tabId, domService);

		// Initialize DOMService to attach debugger
		await domService.initialize();

		// Create and store ElementInteractionService for this tab
		const interactionService = new ElementInteractionService(tab.webContents);
		this.interactionServices.set(tabId, interactionService);
		this.logger.info(`ElementInteractionService initialized for tab ${tabId}`);

		if (bounds) {
			this.tabBounds = bounds;
		}

		// Add to window but keep hidden initially
		this.win.contentView.addChildView(tab);
		this.updateTabVisibility(tabId);

		// Update session state
		const sessionState = this.sessionStates.get(sessionId);
		if (sessionState) {
			sessionState.tabIds.push(tabId);
			// If this is the first tab for the session, set it as active
			if (sessionState.tabIds.length === 1) {
				sessionState.activeTabId = tabId;
				// If this session is the active session, update activeTab reference
				if (this.activeSessionId === sessionId) {
					this.activeTab = tab;
				}
			}
		}

		// Load URL if provided
		if (url) {
			this.logger.debug(`Loading custom URL: ${url}`);
			await tab.webContents.loadURL(url);
			this.logger.debug("page loaded");

			// Page load completion - build DOM tree (no script injection needed)
			tab.webContents.on("did-finish-load", async () => {
				try {
					// Wait for dynamic content to load
					await new Promise((resolve) => setTimeout(resolve, 500));

					// Build simplified DOM tree with fresh state
					await domService.buildSimplifiedDOMTree(false);
					this.logger.debug(`DOM tree built for tab ${tabId}`);
				} catch (error) {
					this.logger.error("Failed to build DOM tree on page load:", error);
				}
			});
		} else {
			this.logger.debug("No URL provided, tab created empty");
		}

		this.logger.info("createTab", tabId, sessionId);
		this.emit("sessiontab:created", { tabId, sessionId });
		return tabId;
	}

	async destroyTab(tabId: TabId): Promise<void> {
		this.logger.info(`Destroying tab ${tabId}`);

		const tab = this.tabs.get(tabId);
		const metadata = this.tabMetadata.get(tabId);
		if (!tab || !metadata) {
			// Even if we don't have the tab, still try to clean up from storage
			this.tabs.delete(tabId);
			this.tabMetadata.delete(tabId);
			return;
		}

		// Cleanup interaction service
		try {
			const interactionService = this.interactionServices.get(tabId);
			if (interactionService) {
				await interactionService.destroy();
				this.interactionServices.delete(tabId);
				this.logger.debug(
					`ElementInteractionService destroyed for tab ${tabId}`,
				);
			}
		} catch (error) {
			this.logger.error(
				`Error cleaning up interaction service for tab ${tabId}:`,
				error,
			);
		}

		try {
			// Stop and cleanup WebContents
			if (tab.webContents && !tab.webContents.isDestroyed()) {
				try {
					this.logger.debug(`Stopping webContents for tab ${tabId}`);
					tab.webContents.stop();
					tab.webContents.removeAllListeners();
					tab.webContents.close({ waitForBeforeUnload: false });
					tab.webContents.forcefullyCrashRenderer();
					this.logger.debug(`WebContents for tab ${tabId} stopped`);
				} catch (error) {
					this.logger.error(
						`Error cleaning up WebContents for tab ${tabId}:`,
						error,
					);
				}
			}
		} catch (error) {
			this.logger.error(
				`Error in webContents cleanup for tab ${tabId}:`,
				error,
			);
		}

		try {
			// Remove from window only if window still exists and isn't destroyed
			if (this.win && !this.win.isDestroyed()) {
				this.logger.debug(`Removing tab ${tabId} from window`);
				this.win.contentView.removeChildView(tab);
				this.logger.debug(`Tab ${tabId} removed from window`);
			} else {
				this.logger.debug(
					`Window is destroyed, skipping tab removal for ${tabId}`,
				);
			}
		} catch (error) {
			this.logger.error(`Error removing tab ${tabId} from window:`, error);
		}

		// Update session state
		const state = this.sessionStates.get(metadata.sessionId);
		if (state) {
			// Remove tabId from session's tabIds array
			const tabIndex = state.tabIds.indexOf(tabId);
			if (tabIndex > -1) {
				state.tabIds.splice(tabIndex, 1);
			}

			// If this was the active tab, select a new active tab
			if (state.activeTabId === tabId) {
				state.activeTabId = state.tabIds.length > 0 ? state.tabIds[0] : null;
				if (this.activeSessionId === metadata.sessionId) {
					this.activeTab =
						state.activeTabId ? this.tabs.get(state.activeTabId) || null : null;
				}
			}
		}

		// Clean up storage
		this.tabs.delete(tabId);
		this.tabMetadata.delete(tabId);
		this.domServices.delete(tabId);

		this.emit("threadview:destroyed", tabId);
		this.logger.info(`Tab ${tabId} destroyed successfully`);
	}

	// ===================
	// VISIBILITY MANAGEMENT
	// ===================

	async setFrontendVisibility(isVisible: boolean): Promise<void> {
		if (this.activeSessionId) {
			const tabId = this.sessionStates.get(this.activeSessionId)?.activeTabId;
			if (tabId) {
				this.frontendVisibility = isVisible;
				await this.updateTabVisibility(tabId);
			}
		}
	}

	async setBackendVisibility(tabId: TabId, isVisible: boolean): Promise<void> {
		const metadata = this.tabMetadata.get(tabId);
		if (!metadata) return;

		metadata.backendVisibility = isVisible;
		await this.updateTabVisibility(tabId);
	}

	private async updateTabVisibility(tabId: TabId): Promise<void> {
		const tab = this.tabs.get(tabId);
		const metadata = this.tabMetadata.get(tabId);
		if (!tab || !metadata) {
			this.logger.warn(
				`Cannot update visibility for tab ${tabId}: tab or metadata not found`,
			);
			return;
		}

		// Check if this tab belongs to the active session
		const isActiveSession = metadata.sessionId === this.activeSessionId;
		const sessionState = this.sessionStates.get(metadata.sessionId);
		const isActiveTab = sessionState?.activeTabId === tabId;

		// Tab is visible only if:
		// 1. It belongs to the active session
		// 2. It's the active tab of that session
		// 3. Both frontend and backend visibility are true
		const shouldBeVisible =
			isActiveSession &&
			isActiveTab &&
			this.frontendVisibility &&
			metadata.backendVisibility;

		this.logger.debug(`Updating visibility for tab ${tabId}:`, {
			isActiveSession,
			isActiveTab,
			frontendVisibility: this.frontendVisibility,
			backendVisibility: metadata.backendVisibility,
			shouldBeVisible,
		});

		if (shouldBeVisible) {
			// Hide all other tabs first
			await this.hideAllTabsExcept(tabId);

			// Show this tab
			tab.setBounds(this.tabBounds);
			tab.setVisible(true);
			this.logger.debug(`tab ${tabId} is set to be visible`);
		} else {
			tab.setVisible(false);
			this.logger.debug(`tab ${tabId} is set to be invisible`);
		}
	}

	async setBounds(bounds: Rectangle): Promise<void> {
		this.logger.debug(`Setting bounds to:`, bounds);
		this.tabBounds = bounds;
		// Update bounds for the active tab if it exists
		if (this.activeTab) {
			this.activeTab.setBounds(bounds);
			this.logger.debug(`Bounds updated for active tab`);
		} else {
			this.logger.debug(`No active tab to update bounds`);
		}
	}

	// ===================
	// GETTERS
	// ===================

	getTab(tabId: TabId): WebContentsView | null {
		return this.tabs.get(tabId) || null;
	}

	getDomService(tabId: TabId): DOMService | null {
		return this.domServices.get(tabId) || null;
	}

	getInteractionService(tabId: TabId): ElementInteractionService | null {
		return this.interactionServices.get(tabId) || null;
	}

	getActiveTabForSession(sessionId: SessionId): TabId | null {
		const state = this.sessionStates.get(sessionId);
		return state?.activeTabId || null;
	}

	getSessionTabState(sessionId: SessionId): sessionTabState | null {
		return this.sessionStates.get(sessionId) || null;
	}

	getTabsForSession(sessionId: SessionId): TabId[] {
		const state = this.sessionStates.get(sessionId);
		return state?.tabIds || [];
	}

	getAllSessionIds(): SessionId[] {
		return Array.from(this.sessionStates.keys());
	}

	getAllTabMetadata(sessionId: SessionId): TabMetadata[] {
		const state = this.sessionStates.get(sessionId);
		if (!state) return [];

		return state.tabIds
			.map((tabId) => this.tabMetadata.get(tabId))
			.filter((metadata): metadata is TabMetadata => metadata !== undefined);
	}

	getTabMetadata(tabId: TabId): TabMetadata | null {
		return this.tabMetadata.get(tabId) || null;
	}

	updateTabTimestamp(tabId: TabId): void {
		const metadata = this.tabMetadata.get(tabId);
		if (metadata) {
			metadata.timestamp = Date.now();
			this.tabMetadata.set(tabId, metadata);
		}
	}

	// ===================
	// PRIVATE HELPERS
	// ===================

	private async hideAllTabsExcept(exceptTabId?: TabId): Promise<void> {
		const hidePromises: Promise<void>[] = [];

		this.tabs.forEach((tab, tabId) => {
			if (tabId !== exceptTabId && tab.getVisible()) {
				// Use setBackendVisibility to properly track the reason for hiding
				hidePromises.push(this.setBackendVisibility(tabId, false));
			}
		});

		await Promise.all(hidePromises);
	}

	private async hideSessionTabs(sessionId: SessionId): Promise<void> {
		const state = this.sessionStates.get(sessionId);
		if (!state) return;

		// Hide all tabs for this session by setting backend visibility to false
		const hidePromises: Promise<void>[] = [];
		for (const tabId of state.tabIds) {
			const tab = this.tabs.get(tabId);
			if (tab?.getVisible()) {
				hidePromises.push(this.setBackendVisibility(tabId, false));
			}
		}

		await Promise.all(hidePromises);
	}

	// ===================
	// CLEANUP
	// ===================
	async destroy(): Promise<void> {
		try {
			// Delete all sessions (which will destroy their tabs)
			const deletePromises = Array.from(this.sessionStates.keys()).map(
				(sessionId) => this.deleteSession(sessionId),
			);
			await Promise.all(deletePromises);

			// Force cleanup of any remaining tabs
			for (const [tabId, _] of this.tabs) {
				try {
					this.logger.debug(`Force cleanup of tab ${tabId}`);
					this.destroyTab(tabId);
				} catch (error) {
					this.logger.error(`Error destroying tab ${tabId}:`, error);
				}
			}
		} catch (error) {
			this.logger.error("Error during SessionTabService.destroy():", error);
		} finally {
			// Still clean up what we can
			this.tabs.clear();
			this.tabMetadata.clear();
			this.domServices.clear();
			this.interactionServices.clear();
			this.sessionStates.clear();
			this.removeAllListeners();
			this.activeSessionId = null;
			this.activeTab = null;
		}
	}
}
