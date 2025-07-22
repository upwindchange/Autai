import type { BackendActions } from "../types";
import type {
  CreateTaskCommand,
  DeleteTaskCommand,
  AddPageCommand,
  DeletePageCommand,
  SelectPageCommand,
  NavigateToCommand,
} from "../../../electron/shared/types/commands";

export const createBackendActions = (): BackendActions => ({
  createTask: async (title?: string, initialUrl?: string) => {
    try {
      // Default to Reddit or Amazon for testing
      const defaultUrls = [
        "https://www.reddit.com",
        "https://www.amazon.com",
      ];
      const defaultUrl =
        initialUrl ||
        defaultUrls[Math.floor(Math.random() * defaultUrls.length)];

      const command: CreateTaskCommand = {
        title: title || "New Task",
        initialUrl: defaultUrl,
      };

      const result = await window.ipcRenderer.invoke("app:createTask", command);

      if (!result.success) {
        console.error("Failed to create task:", result.error);
      }
    } catch (error) {
      console.error("Error creating task:", error);
    }
  },

  deleteTask: async (taskId: string) => {
    try {
      const command: DeleteTaskCommand = {
        taskId,
      };
      const result = await window.ipcRenderer.invoke("app:deleteTask", command);
      if (!result.success) {
        console.error("Failed to delete task:", result.error);
      }
    } catch (error) {
      console.error("Error deleting task:", error);
    }
  },

  addPage: async (taskId: string, url: string) => {
    try {
      const command: AddPageCommand = {
        taskId,
        url,
      };
      const result = await window.ipcRenderer.invoke("app:addPage", command);
      if (!result.success) {
        console.error("Failed to add page:", result.error);
      }
    } catch (error) {
      console.error("Error adding page:", error);
    }
  },

  deletePage: async (taskId: string, pageId: string) => {
    try {
      const command: DeletePageCommand = {
        taskId,
        pageId,
      };
      const result = await window.ipcRenderer.invoke("app:deletePage", command);
      if (!result.success) {
        console.error("Failed to delete page:", result.error);
      }
    } catch (error) {
      console.error("Error deleting page:", error);
    }
  },

  selectPage: async (taskId: string, pageId: string) => {
    try {
      const command: SelectPageCommand = {
        taskId,
        pageId,
      };
      const result = await window.ipcRenderer.invoke("app:selectPage", command);
      if (!result.success) {
        console.error("Failed to select page:", result.error);
      }
    } catch (error) {
      console.error("Error selecting page:", error);
    }
  },

  navigate: async (taskId: string, pageId: string, url: string) => {
    try {
      const command: NavigateToCommand = {
        taskId,
        pageId,
        url,
      };
      const result = await window.ipcRenderer.invoke("app:navigate", command);
      if (!result.success) {
        console.error("Failed to navigate:", result.error);
      }
    } catch (error) {
      console.error("Error navigating:", error);
    }
  },
});