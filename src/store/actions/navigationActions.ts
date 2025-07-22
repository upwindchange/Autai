import type { NavigationActions } from "../types";
import type { NavigationControlCommand } from "../../../electron/shared/types/commands";

export const createNavigationActions = (): NavigationActions => ({
  goBack: async (taskId: string, pageId: string) => {
    try {
      const command: NavigationControlCommand = {
        taskId,
        pageId,
        action: "back",
      };
      const result = await window.ipcRenderer.invoke(
        "app:navigationControl",
        command
      );
      if (!result.success) {
        console.error("Failed to go back:", result.error);
      }
    } catch (error) {
      console.error("Error going back:", error);
    }
  },

  goForward: async (taskId: string, pageId: string) => {
    try {
      const command: NavigationControlCommand = {
        taskId,
        pageId,
        action: "forward",
      };
      const result = await window.ipcRenderer.invoke(
        "app:navigationControl",
        command
      );
      if (!result.success) {
        console.error("Failed to go forward:", result.error);
      }
    } catch (error) {
      console.error("Error going forward:", error);
    }
  },

  reload: async (taskId: string, pageId: string) => {
    try {
      const command: NavigationControlCommand = {
        taskId,
        pageId,
        action: "reload",
      };
      const result = await window.ipcRenderer.invoke(
        "app:navigationControl",
        command
      );
      if (!result.success) {
        console.error("Failed to reload:", result.error);
      }
    } catch (error) {
      console.error("Error reloading:", error);
    }
  },

  stop: async (taskId: string, pageId: string) => {
    try {
      const command: NavigationControlCommand = {
        taskId,
        pageId,
        action: "stop",
      };
      const result = await window.ipcRenderer.invoke(
        "app:navigationControl",
        command
      );
      if (!result.success) {
        console.error("Failed to stop:", result.error);
      }
    } catch (error) {
      console.error("Error stopping:", error);
    }
  },
});