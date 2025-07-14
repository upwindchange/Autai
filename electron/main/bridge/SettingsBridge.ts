import { IpcMainInvokeEvent } from "electron";
import { BaseBridge } from "./BaseBridge";
import { settingsService } from "../services";
import type { SettingsState, TestConnectionConfig } from "../../shared/types/settings";

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

    // Get active settings
    this.handle("settings:getActive", async () => {
      return settingsService.getActiveSettings();
    });

    // Check if configured
    this.handle("settings:isConfigured", async () => {
      return settingsService.isConfigured();
    });
  }
}
