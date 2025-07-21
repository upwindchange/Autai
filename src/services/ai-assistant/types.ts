import type { Message } from "ai";

export interface ThreadConfig {
  taskId: string;
  title?: string;
  model?: string;
  apiKey?: string;
  apiUrl?: string;
  systemPrompt?: string;
}

export interface Thread {
  id: string;
  taskId: string;
  title: string;
  messages: Message[];
  isLoading: boolean;
  error?: Error;
}