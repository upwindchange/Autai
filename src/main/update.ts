import { autoUpdater } from "electron-updater";
import type { UpdateInfo } from "electron-updater";
import { sendAlert, sendInfo, sendSuccess } from "@/utils/messageUtils";
import { i18n } from "@/i18n";

export function update() {
  autoUpdater.autoDownload = true;
  autoUpdater.disableWebInstaller = false;
  autoUpdater.allowDowngrade = false;

  autoUpdater.on("update-available", (arg: UpdateInfo) => {
    sendInfo(
      i18n.t("update.availableTitle"),
      i18n.t("update.availableBody", { version: arg.version }),
    );
  });

  autoUpdater.on("update-downloaded", (arg: UpdateInfo) => {
    sendSuccess(
      i18n.t("update.readyTitle"),
      i18n.t("update.readyBody", { version: arg.version }),
    );
  });

  autoUpdater.on("error", (error: Error) => {
    sendAlert(i18n.t("update.errorTitle"), error.message);
  });
}
