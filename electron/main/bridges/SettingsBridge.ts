import { IpcMainInvokeEvent } from "electron";
import { BaseBridge } from "./BaseBridge";
import { settingsService } from "../services";
import type { SettingsState, TestConnectionConfig } from "@shared/index";
import log from "electron-log/main";

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
      }
    );

    // Test connection
    this.handle(
      "settings:test",
      async (_event: IpcMainInvokeEvent, config: TestConnectionConfig) => {
        return await settingsService.testConnection(config);
      }
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
        log.transports.file.level = logLevel as any;
        log.transports.console.level = logLevel as any;
        log.transports.ipc.level = logLevel as any;
        
        this.logger.info(`Log level changed to: ${logLevel}`);
        return { success: true };
      }
    );
  }
}
