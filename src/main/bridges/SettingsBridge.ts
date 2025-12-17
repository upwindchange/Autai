import { IpcMainInvokeEvent } from "electron";
import { BaseBridge } from "@/bridges/BaseBridge";
import { settingsService } from "@/services";
import type { SettingsState, TestConnectionConfig } from "@shared";
import log from "electron-log/main";
import type { LogLevel } from "@shared";

/**
 * Handles settings-related IPC operations
 */
export class SettingsBridge extends BaseBridge {
	setupHandlers(): void {
		// Load settings
		this.handle("settings:load", async () => {
			return await settingsService.loadSettings();
		});

		// Save settings
		this.handle(
			"settings:save",
			async (_event: IpcMainInvokeEvent, settings: SettingsState) => {
				await settingsService.saveSettings(settings);
				return { success: true };
			},
		);

		// Test connection
		this.handle(
			"settings:test",
			async (_event: IpcMainInvokeEvent, config: TestConnectionConfig) => {
				await settingsService.testConnection(config);
			},
		);

		// Get settings
		this.handle("settings:get", async () => {
			return settingsService.settings;
		});

		// Check if configured
		this.handle("settings:isConfigured", async () => {
			return settingsService.isConfigured();
		});

		// Update log level
		this.handle(
			"settings:updateLogLevel",
			async (_event: IpcMainInvokeEvent, logLevel: string) => {
				// Apply to electron-log immediately
				// electron-log accepts string literals for log levels
				log.transports.file.level = logLevel as LogLevel;
				log.transports.console.level = logLevel as LogLevel;
				log.transports.ipc.level = logLevel as LogLevel;

				this.logger.info(`Log level changed to: ${logLevel}`);
				return { success: true };
			},
		);

		// Get log file path
		this.handle("settings:getLogPath", async () => {
			const file = log.transports.file.getFile();
			return file?.path || "";
		});

		// Clear logs
		this.handle("settings:clearLogs", async () => {
			try {
				const file = log.transports.file.getFile();
				if (file) {
					file.clear();
					this.logger.info("Log file cleared");
				}
				return { success: true };
			} catch (error) {
				this.logger.error("Failed to clear logs:", error);
				throw error;
			}
		});

		// Open log folder
		this.handle("settings:openLogFolder", async () => {
			const { shell } = await import("electron");
			const file = log.transports.file.getFile();
			if (file?.path) {
				const path = await import("path");
				const logDir = path.dirname(file.path);
				await shell.openPath(logDir);
			}
			return { success: true };
		});

		// Open DevTools
		this.handle("settings:openDevTools", async (_event: IpcMainInvokeEvent) => {
			const { BrowserWindow } = await import("electron");
			const win = BrowserWindow.getFocusedWindow();
			if (win) {
				win.webContents.openDevTools();
			}
			return { success: true };
		});
	}
}
