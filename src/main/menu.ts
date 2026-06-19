import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from "electron";
import { settingsService } from "@/services";

/**
 * Reset connection mode to "standalone" (Local Mode) and relaunch so the API
 * server rebinds to 127.0.0.1 on a random port.
 *
 * saveSettings() writes via a synchronous SQLite transaction, so the new
 * server_mode is committed before app.quit() returns. app.quit() routes
 * through the existing before-quit cleanup (apiServer.stop, closeDatabase,
 * PQueueManager.shutdown, telemetry, window destroy — guarded by isCleaningUp
 * so it runs once). app.relaunch() schedules a fresh instance to spawn when
 * the process exits; the single-instance lock is released before the new
 * instance acquires it.
 */
export function resetToLocalMode(): void {
  settingsService.saveSettings({
    ...settingsService.settings,
    serverMode: "standalone",
  });
  app.relaunch();
  app.quit();
}

/**
 * The "Option" menu — app-specific actions. Append new items to `optionItems`
 * to grow this menu.
 */
function buildOptionMenu(): MenuItemConstructorOptions {
  const optionItems: MenuItemConstructorOptions[] = [
    {
      label: "Reset to Local Mode",
      click: () => resetToLocalMode(),
    },
  ];

  return { label: "Option", submenu: optionItems };
}

/**
 * Custom "View" menu. We use explicit click handlers instead of the `viewMenu`
 * role because the role-based items (zoom/reload/devtools) dispatch to the
 * *focused* webContents — which is not focused at startup, so they were no-ops
 * until the user clicked into the renderer. These handlers act on the main
 * window's webContents directly, so they work immediately at startup
 * regardless of focus state.
 *
 * Note: zoom *keyboard* shortcuts (Ctrl + /- /0) remain blocked by the
 * before-input-event handler in index.ts; only the menu clicks zoom here.
 */
function buildViewMenu(win: BrowserWindow): MenuItemConstructorOptions {
  const wc = win.webContents;
  return {
    label: "View",
    submenu: [
      {
        label: "Reload",
        accelerator: "CmdOrCtrl+R",
        click: () => wc.reload(),
      },
      {
        label: "Force Reload",
        accelerator: "CmdOrCtrl+Shift+R",
        click: () => wc.reloadIgnoringCache(),
      },
      {
        label: "Toggle Developer Tools",
        accelerator: "CmdOrCtrl+Shift+I",
        click: () => wc.toggleDevTools(),
      },
      { type: "separator" },
      {
        label: "Actual Size",
        accelerator: "CmdOrCtrl+0",
        click: () => wc.setZoomFactor(1),
      },
      {
        label: "Zoom In",
        accelerator: "CmdOrCtrl+=",
        click: () => wc.setZoomFactor(Math.min(5, wc.getZoomFactor() + 0.1)),
      },
      {
        label: "Zoom Out",
        accelerator: "CmdOrCtrl+-",
        click: () => wc.setZoomFactor(Math.max(0.25, wc.getZoomFactor() - 0.1)),
      },
      { type: "separator" },
      {
        label: "Toggle Full Screen",
        accelerator: "F11",
        click: () => win.setFullScreen(!win.isFullScreen()),
      },
    ],
  };
}

/**
 * Application menu: default Electron menus (File/Edit/Window via roles) plus a
 * custom View menu and our "Option" menu.
 */
export function buildApplicationMenu(win: BrowserWindow): Menu {
  const template: MenuItemConstructorOptions[] = [
    { role: "fileMenu" },
    { role: "editMenu" },
    buildViewMenu(win),
    buildOptionMenu(),
    { role: "windowMenu" },
  ];
  return Menu.buildFromTemplate(template);
}
