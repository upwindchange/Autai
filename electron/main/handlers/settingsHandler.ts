import { ipcMain } from "electron";
import { settingsService } from "../services";

export function setupSettingsHandlers() {
  // Load settings
  ipcMain.handle("settings:load", async () => {
    return await settingsService.loadSettings();
  });

  // Save settings
  ipcMain.handle("settings:save", async (_, settings) => {
    await settingsService.saveSettings(settings);
    return { success: true };
  });

  // Test connection
  ipcMain.handle("settings:test", async (_, config) => {
    return await settingsService.testConnection(config);
  });

  // Get active settings
  ipcMain.handle("settings:getActive", async () => {
    return settingsService.getActiveSettings();
  });

  // Check if configured
  ipcMain.handle("settings:isConfigured", async () => {
    return settingsService.isConfigured();
  });
}