/**
 * Streaming-related types shared between main and renderer processes
 */

export interface StreamChunk {
  type: "token" | "error" | "metadata" | "tool_call";
  content: string;
  metadata?: Record<string, unknown>;
}

export interface StreamingAgentConfig {
  taskId: string;
  apiUrl?: string;
  apiKey?: string;
  model?: string;
}

export interface AgentStreamOptions {
  message: string;
}
