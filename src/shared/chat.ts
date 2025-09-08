import { type UIMessage } from "ai";

/**
 * Request structure for chat endpoints
 */
export interface ChatRequest {
  messages: UIMessage[];
  requestId: string;
  system?: string;
  tools?: unknown;
}