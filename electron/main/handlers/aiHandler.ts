import { ipcMain, IpcMainInvokeEvent } from "electron";
import { agentService } from "../services/agentService";
import { ViewManager } from "../services/viewManagerService";

export function setupAIHandlers(viewManager: ViewManager) {
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