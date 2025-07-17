import { IpcMainInvokeEvent, BrowserWindow } from "electron";
import { BaseBridge } from "./BaseBridge";
import { ChatAgentService } from "../services/ChatAgentService";
import type { UIMessage } from "ai";

interface ChatSendMessagesData {
  id: string;
  messages: UIMessage[];
  trigger: 'submit-user-message' | 'submit-tool-result' | 'regenerate-assistant-message';
  messageId?: string;
  metadata?: unknown;
  body?: Record<string, any>;
  streamId: string;
}

interface ChatReconnectData {
  id: string;
  metadata?: unknown;
  body?: Record<string, any>;
}

/**
 * Bridge for handling AI SDK chat transport over IPC
 */
export class ChatBridge extends BaseBridge {
  private chatAgentService: ChatAgentService;
  private win: BrowserWindow;

  constructor(win: BrowserWindow) {
    super();
    this.win = win;
    this.chatAgentService = new ChatAgentService();
  }

  setupHandlers(): void {
    this.handle<ChatSendMessagesData>("chat:sendMessages", this.handleSendMessages.bind(this));
    this.handle<ChatReconnectData>("chat:reconnectToStream", this.handleReconnectToStream.bind(this));
  }

  private async handleSendMessages(
    event: IpcMainInvokeEvent,
    data: ChatSendMessagesData
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Start streaming in the background
      this.streamInBackground(data);
      return { success: true };
    } catch (error) {
      console.error("Error in handleSendMessages:", error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : "Unknown error" 
      };
    }
  }

  private async streamInBackground(data: ChatSendMessagesData): Promise<void> {
    try {
      const stream = this.chatAgentService.streamChat(data);
      
      for await (const chunk of stream) {
        // Send chunk to renderer
        if (!this.win.isDestroyed() && this.win.webContents) {
          this.win.webContents.send("chat:sendMessages:response", chunk);
        }
      }
    } catch (error) {
      // Send error to renderer
      if (!this.win.isDestroyed() && this.win.webContents) {
        this.win.webContents.send("chat:sendMessages:response", {
          streamId: data.streamId,
          type: "error",
          error: error instanceof Error ? error.message : "Stream processing error",
        });
      }
    }
  }

  private async handleReconnectToStream(
    event: IpcMainInvokeEvent,
    data: ChatReconnectData
  ): Promise<{ hasActiveStream: boolean; streamId?: string }> {
    const result = this.chatAgentService.hasActiveStream(data.id);
    return { hasActiveStream: result.hasStream, streamId: result.streamId };
  }

  destroy(): void {
    // Clean up the chat agent service
    this.chatAgentService.cleanup();
    super.destroy();
  }
}