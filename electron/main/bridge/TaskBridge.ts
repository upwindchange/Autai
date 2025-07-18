import { IpcMainInvokeEvent } from "electron";
import { BaseBridge } from "./BaseBridge";
import { agentManagerService, type StateManager } from "../services";
import type {
  CreateTaskCommand,
  DeleteTaskCommand,
  AddPageCommand,
  DeletePageCommand,
  SelectPageCommand,
} from "../../shared/types/index";

/**
 * Handles task and page-related IPC operations
 */
export class TaskBridge extends BaseBridge {
  protected stateManager: StateManager;

  constructor(stateManager: StateManager) {
    super();
    this.stateManager = stateManager;
  }

  setupHandlers(): void {
    // Task operations
    this.handle(
      "app:createTask",
      async (_event: IpcMainInvokeEvent, command: CreateTaskCommand) => {
        const task = this.stateManager.createTask(
          command.title,
          command.initialUrl
        );
        return { success: true, data: task };
      }
    );

    this.handle(
      "app:deleteTask",
      async (_event: IpcMainInvokeEvent, command: DeleteTaskCommand) => {
        // Remove the AI agent associated with this task
        agentManagerService.removeAgent(command.taskId);

        // Delete the task
        this.stateManager.deleteTask(command.taskId);
        return { success: true };
      }
    );

    // Page operations
    this.handle(
      "app:addPage",
      async (_event: IpcMainInvokeEvent, command: AddPageCommand) => {
        const page = await this.stateManager.addPage(
          command.taskId,
          command.url
        );
        return { success: true, data: page };
      }
    );

    this.handle(
      "app:deletePage",
      async (_event: IpcMainInvokeEvent, command: DeletePageCommand) => {
        this.stateManager.removePage(command.taskId, command.pageId);
        return { success: true };
      }
    );

    this.handle(
      "app:selectPage",
      async (_event: IpcMainInvokeEvent, command: SelectPageCommand) => {
        const view = this.stateManager.getViewForPage(
          command.taskId,
          command.pageId
        );
        if (view) {
          this.stateManager.setActiveView(view.id);

          // Update task's active page
          const task = this.stateManager.getTask(command.taskId);
          if (task) {
            task.activePageId = command.pageId;
          }
        }
        return { success: true };
      }
    );

    // Expand/collapse task (UI-only state)
    this.handle(
      "app:setExpandedTask",
      async (_event: IpcMainInvokeEvent, _taskId: string | null) => {
        // This is UI-only state, just acknowledge it
        return { success: true };
      }
    );

    // Get initial state
    this.handle("app:getState", async () => {
      return this.stateManager.getFullState();
    });
  }
}
