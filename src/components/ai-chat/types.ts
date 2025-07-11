/**
 * Core types for the AI chat system with streaming support
 */

/**
 * Represents a single message in the chat
 */
export interface Message {
  id: string;
  content: string;
  sender: 'user' | 'assistant' | 'system';
  isComplete: boolean;
  timestamp: Date;
  taskId: string;
  error?: string;
}

/**
 * Represents a streaming chunk from the AI
 */
export interface StreamChunk {
  type: 'token' | 'error' | 'metadata' | 'tool_call';
  content: string;
  metadata?: Record<string, unknown>;
}

/**
 * Chat state for a specific task
 */
export interface TaskChatState {
  messages: Message[];
  isStreaming: boolean;
  currentStreamId?: string;
}

/**
 * Props for chat components
 */
export interface ChatContainerProps {
  taskId: string | null;
  activeViewKey: string | null;
}

export interface MessageListProps {
  messages: Message[];
  taskId: string;
}

export interface MessageItemProps {
  message: Message;
}

export interface InputBoxProps {
  onSend: (message: string) => void;
  disabled: boolean;
  placeholder?: string;
}

/**
 * Hook return types
 */
export interface UseStreamingChatReturn {
  messages: Message[];
  sendMessage: (content: string) => Promise<void>;
  isStreaming: boolean;
  clearMessages: () => void;
}

export interface UseTaskChatReturn extends UseStreamingChatReturn {
  taskId: string | null;
}