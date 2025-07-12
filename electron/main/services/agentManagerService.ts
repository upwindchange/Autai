import { StreamingAgentService } from "./streamingAgentService";
import type { StreamingAgentConfig } from "../../shared/types/index";
import type { BaseMessage } from "@langchain/core/messages";

/**
 * Manages StreamingAgentService instances for different tasks.
 * Ensures each task has its own isolated AI agent with separate conversation history.
 */
class AgentManagerService {
  private agents: Map<string, StreamingAgentService> = new Map();

  /**
   * Get or create an agent for a specific task
   */
  getOrCreateAgent(
    taskId: string,
    config?: Partial<StreamingAgentConfig>
  ): StreamingAgentService {
    let agent = this.agents.get(taskId);

    if (!agent) {
      const agentConfig: StreamingAgentConfig = {
        taskId,
        ...config,
      };
      agent = new StreamingAgentService(agentConfig);
      this.agents.set(taskId, agent);
    } else if (config) {
      // Update existing agent config if provided
      agent.updateConfig(config);
    }

    return agent;
  }

  /**
   * Remove an agent and cleanup its resources
   */
  removeAgent(taskId: string): void {
    const agent = this.agents.get(taskId);
    if (agent) {
      agent.cleanup();
      this.agents.delete(taskId);
    }
  }

  /**
   * Clear conversation history for a specific task
   */
  async clearHistory(taskId: string): Promise<void> {
    const agent = this.agents.get(taskId);
    if (agent) {
      await agent.clearHistory();
    }
  }

  /**
   * Get conversation history for a specific task
   */
  async getHistory(taskId: string): Promise<BaseMessage[]> {
    const agent = this.agents.get(taskId);
    if (agent) {
      return await agent.getHistory();
    }
    return [];
  }

  /**
   * Get list of tasks with active agents
   */
  getActiveTasks(): string[] {
    return Array.from(this.agents.keys());
  }

  /**
   * Check if a task has an active agent
   */
  hasAgent(taskId: string): boolean {
    return this.agents.has(taskId);
  }

  /**
   * Cleanup all agents
   */
  cleanup(): void {
    for (const agent of this.agents.values()) {
      agent.cleanup();
    }
    this.agents.clear();
  }
}

// Export singleton instance
export const agentManagerService = new AgentManagerService();
