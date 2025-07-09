import { ipcMain, IpcMainInvokeEvent } from "electron";
import { TaskAgentManager } from "../services";
import type { StreamChunk } from "../types/streaming";

/**
 * IPC handlers for streaming AI functionality
 */
export function registerStreamingAIHandlers() {
  const taskAgentManager = TaskAgentManager.getInstance();

  /**
   * Start streaming a message response for a specific task
   */
  ipcMain.handle("ai:streamMessage", async (event: IpcMainInvokeEvent, taskId: string, message: string, includeContext: boolean = false) => {
    try {
      console.log(`Starting stream for task ${taskId}: ${message}`);
      
      // Get the agent for this task
      const agent = taskAgentManager.getOrCreateAgent(taskId);
      
      // Generate unique stream ID
      const streamId = `${taskId}-${Date.now()}`;
      
      // Get context if requested
      let context = undefined;
      if (includeContext) {
        // Context will be provided by the renderer if needed
        // TODO: Implement view context retrieval if needed
      }
      
      // Start streaming in background
      (async () => {
        try {
          for await (const chunk of agent.streamMessage({ message, context })) {
            // Send chunk to renderer
            event.sender.send(`ai:stream:${streamId}`, chunk);
          }
          // Signal stream end
          event.sender.send(`ai:stream:${streamId}:end`);
        } catch (error) {
          console.error('Streaming error:', error);
          const errorChunk: StreamChunk = {
            type: 'error',
            content: error instanceof Error ? error.message : 'Unknown error occurred',
            metadata: { taskId }
          };
          event.sender.send(`ai:stream:${streamId}`, errorChunk);
          event.sender.send(`ai:stream:${streamId}:end`);
        }
      })();
      
      return streamId;
    } catch (error) {
      console.error('Error starting stream:', error);
      throw error;
    }
  });

  /**
   * Clear chat history for a specific task
   */
  ipcMain.handle("ai:clearHistory", async (event: IpcMainInvokeEvent, taskId: string) => {
    try {
      const agent = taskAgentManager.getOrCreateAgent(taskId);
      await agent.clearHistory();
      return { success: true };
    } catch (error) {
      console.error('Error clearing history:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Get chat history for a specific task
   */
  ipcMain.handle("ai:getHistory", async (event: IpcMainInvokeEvent, taskId: string) => {
    try {
      const agent = taskAgentManager.getOrCreateAgent(taskId);
      const history = await agent.getHistory();
      return history;
    } catch (error) {
      console.error('Error getting history:', error);
      return [];
    }
  });

  /**
   * Remove agent when task is deleted
   */
  ipcMain.handle("ai:removeAgent", async (event: IpcMainInvokeEvent, taskId: string) => {
    try {
      taskAgentManager.removeAgent(taskId);
      return { success: true };
    } catch (error) {
      console.error('Error removing agent:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Get active task IDs (for debugging)
   */
  ipcMain.handle("ai:getActiveTasks", async () => {
    return taskAgentManager.getActiveTaskIds();
  });
}