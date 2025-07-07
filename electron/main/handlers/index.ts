import { BrowserWindow } from "electron";
import { ViewManager, NavigationService } from "../services";
import { setupNavigationHandlers } from "./navigationHandler";
import { setupViewHandlers } from "./viewHandler";
import { setupHintHandlers } from "./hintHandler";
import { setupAIHandlers } from "./aiHandler";

export function setupIpcHandlers(win: BrowserWindow, viewManager: ViewManager) {
  const navigationService = new NavigationService(viewManager);

  // Setup all handlers
  setupViewHandlers(viewManager, win);
  setupNavigationHandlers(navigationService);
  setupHintHandlers(viewManager);
  setupAIHandlers(viewManager);
}