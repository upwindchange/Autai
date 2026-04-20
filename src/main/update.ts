import { app, ipcMain } from "electron";
import { autoUpdater } from "electron-updater";
import type { UpdateInfo } from "electron-updater";
import { sendAlert, sendInfo, sendSuccess } from "@/utils/messageUtils";

export function update() {
  autoUpdater.autoDownload = true;
  autoUpdater.disableWebInstaller = false;
  autoUpdater.allowDowngrade = false;

  autoUpdater.on("update-available", (arg: UpdateInfo) => {
    sendInfo(
      "Update Available",
      `Downloading v${arg.version} in the background...`,
    );
  });

  autoUpdater.on("update-downloaded", (arg: UpdateInfo) => {
    sendSuccess(
      "Update Ready",
      `v${arg.version} will be installed on next restart.`,
    );
  });

  autoUpdater.on("error", (error: Error) => {
    sendAlert("Update Error", error.message);
  });

  ipcMain.handle("check-update", async () => {
    if (!app.isPackaged) {
      const error = new Error(
        "The update feature is only available after the package.",
      );
      return { message: error.message, error };
    }

    try {
      return await autoUpdater.checkForUpdatesAndNotify();
    } catch (error) {
      return { message: "Network error", error };
    }
  });
}
