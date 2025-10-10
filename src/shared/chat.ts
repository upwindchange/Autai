import { type UIMessage } from "ai";

/**
 * Request structure for chat endpoints
 */
export interface ChatRequest {
  messages: UIMessage[];
  system?: string;
  tools?: unknown;
  threadId: string;
}
