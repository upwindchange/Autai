import { StreamingAgentService } from './streamingAgentService';
import type { StreamingAgentConfig } from '../types/streaming';

/**
 * Manages AI agents on a per-task basis, ensuring each task has its own
 * isolated conversation history and context.
 */
export class TaskAgentManager {
  private static instance: TaskAgentManager;
  private agents = new Map<string, StreamingAgentService>();

  private constructor() {}

  /**
   * Get the singleton instance of TaskAgentManager
   */
  public static getInstance(): TaskAgentManager {
    if (!TaskAgentManager.instance) {
      TaskAgentManager.instance = new TaskAgentManager();
    }
    return TaskAgentManager.instance;
  }

  /**
   * Get or create an agent for a specific task
   */
  public getOrCreateAgent(taskId: string, config?: Partial<StreamingAgentConfig>): StreamingAgentService {
    if (!this.agents.has(taskId)) {
      const agent = new StreamingAgentService({
        taskId,
        ...config
      });
      this.agents.set(taskId, agent);
      console.log(`Created new agent for task: ${taskId}`);
    }
    return this.agents.get(taskId)!;
  }

  /**
   * Remove an agent when a task is deleted
   */
  public removeAgent(taskId: string): void {
    const agent = this.agents.get(taskId);
    if (agent) {
      agent.cleanup();
      this.agents.delete(taskId);
      console.log(`Removed agent for task: ${taskId}`);
    }
  }

  /**
   * Get all active task IDs
   */
  public getActiveTaskIds(): string[] {
    return Array.from(this.agents.keys());
  }

  /**
   * Clear all agents (useful for cleanup)
   */
  public clearAll(): void {
    for (const [taskId, agent] of this.agents.entries()) {
      agent.cleanup();
    }
    this.agents.clear();
    console.log('Cleared all task agents');
  }

  /**
   * Update agent configuration for a task
   */
  public updateAgentConfig(taskId: string, config: Partial<StreamingAgentConfig>): void {
    const agent = this.agents.get(taskId);
    if (agent) {
      agent.updateConfig(config);
    }
  }
}