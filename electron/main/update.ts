import { app, ipcMain } from "electron";
import { createRequire } from "node:module";
import type {
  ProgressInfo,
  UpdateDownloadedEvent,
  UpdateInfo,
} from "electron-updater";

const { autoUpdater } = createRequire(import.meta.url)("electron-updater");

/**
 * Configures auto-updater for the application
 */
export function update(win: Electron.BrowserWindow) {
  /**
   * Auto-updater configuration
   */
  autoUpdater.autoDownload = false;
  autoUpdater.disableWebInstaller = false;
  autoUpdater.allowDowngrade = false;

  /**
   * Update event handlers
   */
  autoUpdater.on("checking-for-update", function () {});

  autoUpdater.on("update-available", (arg: UpdateInfo) => {
    win.webContents.send("update-can-available", {
      update: true,
      version: app.getVersion(),
      newVersion: arg?.version,
    });
  });

  autoUpdater.on("update-not-available", (arg: UpdateInfo) => {
    win.webContents.send("update-can-available", {
      update: false,
      version: app.getVersion(),
      newVersion: arg?.version,
    });
  });

  /**
   * IPC handler for checking updates
   */
  ipcMain.handle("check-update", async () => {
    if (!app.isPackaged) {
      const error = new Error(
        "The update feature is only available after the package."
      );
      return { message: error.message, error };
    }

    try {
      return await autoUpdater.checkForUpdatesAndNotify();
    } catch (error) {
      return { message: "Network error", error };
    }
  });

  /**
   * IPC handler for starting update download with progress feedback
   */
  ipcMain.handle("start-download", (event: Electron.IpcMainInvokeEvent) => {
    startDownload(
      (error, progressInfo) => {
        if (error) {
          event.sender.send("update-error", { message: error.message, error });
        } else {
          event.sender.send("download-progress", progressInfo);
        }
      },
      () => {
        event.sender.send("update-downloaded");
      }
    );
  });

  /**
   * IPC handler for installing downloaded update
   */
  ipcMain.handle("quit-and-install", () => {
    autoUpdater.quitAndInstall(false, true);
  });
}

/**
 * Starts update download and sets up progress/error callbacks
 */
function startDownload(
  callback: (error: Error | null, info: ProgressInfo | null) => void,
  complete: (event: UpdateDownloadedEvent) => void
) {
  autoUpdater.on("download-progress", (info: ProgressInfo) =>
    callback(null, info)
  );
  autoUpdater.on("error", (error: Error) => callback(error, null));
  autoUpdater.on("update-downloaded", complete);
  autoUpdater.downloadUpdate();
}
