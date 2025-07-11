import { IpcMainInvokeEvent } from "electron";
import { BaseBridge } from "./BaseBridge";
import { agentManagerService } from "../services/agentManagerService";

/**
 * Handles AI agent-related IPC operations
 */
export class AgentBridge extends BaseBridge {
  setupHandlers(): void {
    // Stream message
    this.handle(
      "ai:streamMessage",
      async (
        event: IpcMainInvokeEvent,
        taskId: string,
        message: string,
        _includeContext: boolean = false
      ) => {
        const agent = agentManagerService.getOrCreateAgent(taskId);
        const streamId = `${taskId}-${Date.now()}`;

        // Start streaming in background
        (async () => {
          try {
            for await (const chunk of agent.streamMessage({ message })) {
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
                metadata: { taskId },
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
      async (_event: IpcMainInvokeEvent, taskId: string) => {
        await agentManagerService.clearHistory(taskId);
        return { success: true };
      }
    );

    // Get history
    this.handle(
      "ai:getHistory",
      async (_event: IpcMainInvokeEvent, taskId: string) => {
        const history = await agentManagerService.getHistory(taskId);
        // Convert BaseMessage objects to plain objects for IPC
        return history.map((msg) => ({
          content: msg.content,
          role: msg._getType(),
          timestamp: msg.additional_kwargs?.timestamp || Date.now(),
        }));
      }
    );

    // Remove agent
    this.handle(
      "ai:removeAgent",
      async (_event: IpcMainInvokeEvent, taskId: string) => {
        agentManagerService.removeAgent(taskId);
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
