import { ipcMain, BrowserWindow } from "electron";
import { ViewManager } from "./viewManager";
import { NavigationHandlers } from "./navigationHandlers";
import { agentService } from "./agent";

export function setupIpcHandlers(win: BrowserWindow, viewManager: ViewManager) {
  const navigationHandlers = new NavigationHandlers(viewManager);

  // View management handlers
  ipcMain.handle("view:create", async (_, key: string, options) => {
    if (!win) throw new Error("Main window not available");
    return viewManager.createView(key, options);
  });

  ipcMain.handle("view:setBounds", async (_, key, bounds) => {
    return viewManager.setBounds(key, bounds);
  });

  ipcMain.handle("view:remove", async (_, key) => {
    return viewManager.removeView(key);
  });

  // Navigation handlers
  ipcMain.handle("nav:back", async (_, key) => {
    return navigationHandlers.goBack(key);
  });

  ipcMain.handle("nav:forward", async (_, key) => {
    return navigationHandlers.goForward(key);
  });

  ipcMain.handle("nav:canGoBack", async (_, key) => {
    return navigationHandlers.canGoBack(key);
  });

  ipcMain.handle("nav:canGoForward", async (_, key) => {
    return navigationHandlers.canGoForward(key);
  });

  ipcMain.handle("nav:loadURL", async (_, key, url) => {
    return navigationHandlers.loadURL(key, url);
  });

  ipcMain.handle("nav:getCurrentURL", async (_, key) => {
    return navigationHandlers.getCurrentURL(key);
  });

  ipcMain.handle("nav:getFavicon", async (_, key) => {
    return navigationHandlers.getFavicon(key);
  });

  ipcMain.handle("nav:getPageTitle", async (_, key) => {
    return navigationHandlers.getPageTitle(key);
  });

  ipcMain.handle("nav:getHistory", async (_, key) => {
    return navigationHandlers.getHistory(key);
  });

  // Hint handlers
  ipcMain.handle("hints:detect", async (_, key) => {
    return viewManager.detectHints(key);
  });

  ipcMain.handle("hints:show", async (_, key) => {
    return viewManager.showHints(key);
  });

  ipcMain.handle("hints:hide", async (_, key) => {
    return viewManager.hideHints(key);
  });

  // Register dynamic hint click handlers for each view
  const originalCreateView = viewManager.createView.bind(viewManager);
  viewManager.createView = async function(key: string, options: any) {
    const result = await originalCreateView(key, options);
    
    // Register hint click handler for this specific view
    ipcMain.handle(`hint:click:${key}`, async (_, index) => {
      return viewManager.executeHintClick(key, index);
    });
    
    return result;
  };

  // Forward active view change events to renderer
  ipcMain.on("active-view-changed", (_, viewKey) => {
    win.webContents.send("active-view-changed", viewKey);
  });

  // GenAI handler
  ipcMain.handle("genai:send", async (_, message: string) => {
    return agentService.processMessage(message);
  });

  // AI agent handlers for interacting with web pages
  ipcMain.handle("ai:processCommand", async (_, command: string, viewKey: string) => {
    const view = viewManager.getView(viewKey);
    return agentService.processCommandWithContext(command, view);
  });

  ipcMain.handle("ai:getInteractables", async (_, viewKey: string) => {
    return viewManager.getInteractableElements(viewKey);
  });

  ipcMain.handle("ai:clickElement", async (_, viewKey: string, elementId: number) => {
    return viewManager.clickElementById(viewKey, elementId);
  });
}