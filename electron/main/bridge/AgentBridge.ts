import { IpcMainInvokeEvent } from "electron";
import { BaseBridge } from "./BaseBridge";
import { agentManagerService } from "../services";
import type {
  StreamMessageCommand,
  ClearHistoryCommand,
} from "../../shared/types/index";

/**
 * Handles AI agent-related IPC operations
 */
export class AgentBridge extends BaseBridge {
  setupHandlers(): void {
    // Stream message
    this.handle(
      "ai:streamMessage",
      async (event: IpcMainInvokeEvent, command: StreamMessageCommand) => {
        const agent = agentManagerService.getOrCreateAgent(command.taskId);
        const streamId = `${command.taskId}-${Date.now()}`;

        // Start streaming in background
        (async () => {
          try {
            for await (const chunk of agent.streamMessage({
              message: command.message,
            })) {
              if (!event.sender.isDestroyed()) {
                event.sender.send(`ai:stream:${streamId}`, chunk);
              }
            }
            if (!event.sender.isDestroyed()) {
              event.sender.send(`ai:stream:${streamId}:end`);
            }
          } catch (error) {
            console.error("Streaming error:", error);
            if (!event.sender.isDestroyed()) {
              event.sender.send(`ai:stream:${streamId}`, {
                type: "error",
                content:
                  error instanceof Error
                    ? error.message
                    : "An error occurred during streaming",
                metadata: { taskId: command.taskId },
              });
              event.sender.send(`ai:stream:${streamId}:end`);
            }
          }
        })();

        return streamId;
      }
    );

    // Clear history
    this.handle(
      "ai:clearHistory",
      async (_event: IpcMainInvokeEvent, command: ClearHistoryCommand) => {
        await agentManagerService.clearHistory(command.taskId);
        return { success: true };
      }
    );

    // Get history
    this.handle(
      "ai:getHistory",
      async (_event: IpcMainInvokeEvent, command: { taskId: string }) => {
        const history = await agentManagerService.getHistory(command.taskId);
        // Convert BaseMessage objects to plain objects for IPC
        return history.map((msg) => ({
          content: msg.content,
          role: msg.getType(),
          timestamp: msg.additional_kwargs?.timestamp || Date.now(),
        }));
      }
    );

    // Remove agent
    this.handle(
      "ai:removeAgent",
      async (_event: IpcMainInvokeEvent, command: { taskId: string }) => {
        agentManagerService.removeAgent(command.taskId);
        return { success: true };
      }
    );

    // Get active tasks
    this.handle("ai:getActiveTasks", async () => {
      return agentManagerService.getActiveTasks();
    });
  }

  /**
   * Clean up all AI agents
   */
  cleanup(): void {
    agentManagerService.cleanup();
  }
}
