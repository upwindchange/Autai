/**
 * Types for streaming AI functionality in the main process
 */

export interface StreamChunk {
  type: 'token' | 'error' | 'metadata' | 'tool_call';
  content: string;
  metadata?: Record<string, any>;
}

export interface StreamingAgentConfig {
  taskId: string;
  apiUrl?: string;
  apiKey?: string;
  model?: string;
}

export interface AgentStreamOptions {
  message: string;
  context?: {
    currentUrl?: string;
    pageTitle?: string;
    interactableElements?: any[];
  };
}