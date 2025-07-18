import { UIMessage, ChatTransport, UIMessageChunk } from "ai";

export type IPCChatTransportOptions<UI_MESSAGE extends UIMessage> = {
  /**
   * The IPC channel name for sending messages
   * @default 'chat:sendMessages'
   */
  sendChannel?: string;

  /**
   * The IPC channel name for reconnecting to stream
   * @default 'chat:reconnectToStream'
   */
  reconnectChannel?: string;

  /**
   * Optional function to prepare the request before sending
   */
  prepareSendMessagesRequest?: (options: {
    id: string;
    messages: UI_MESSAGE[];
    requestMetadata: unknown;
    body: Record<string, any> | undefined;
    trigger:
      | "submit-user-message"
      | "submit-tool-result"
      | "regenerate-assistant-message";
    messageId: string | undefined;
  }) => Record<string, any> | PromiseLike<Record<string, any>>;

  /**
   * Optional function to prepare reconnect request
   */
  prepareReconnectToStreamRequest?: (options: {
    id: string;
    requestMetadata: unknown;
    body: Record<string, any> | undefined;
  }) => Record<string, any> | PromiseLike<Record<string, any>>;

  /**
   * Metadata to be sent with requests
   */
  metadata?: unknown;

  /**
   * Body object to be sent with requests
   */
  body?: Record<string, any>;
};

export class IPCChatTransport<UI_MESSAGE extends UIMessage>
  implements ChatTransport<UI_MESSAGE>
{
  private sendChannel: string;
  private reconnectChannel: string;
  private metadata?: unknown;
  private body?: Record<string, any>;
  private prepareSendMessagesRequest?: IPCChatTransportOptions<UI_MESSAGE>["prepareSendMessagesRequest"];
  private prepareReconnectToStreamRequest?: IPCChatTransportOptions<UI_MESSAGE>["prepareReconnectToStreamRequest"];

  constructor(options: IPCChatTransportOptions<UI_MESSAGE> = {}) {
    this.sendChannel = options.sendChannel ?? "chat:sendMessages";
    this.reconnectChannel =
      options.reconnectChannel ?? "chat:reconnectToStream";
    this.metadata = options.metadata;
    this.body = options.body;
    this.prepareSendMessagesRequest = options.prepareSendMessagesRequest;
    this.prepareReconnectToStreamRequest =
      options.prepareReconnectToStreamRequest;
  }

  async sendMessages(
    options: Parameters<ChatTransport<UI_MESSAGE>["sendMessages"]>[0]
  ): Promise<ReadableStream<UIMessageChunk>> {
    const preparedRequest = await this.prepareSendMessagesRequest?.({
      id: options.chatId,
      messages: options.messages,
      body: { ...this.body, ...options.body },
      requestMetadata: options.metadata ?? this.metadata,
      trigger: options.trigger,
      messageId: options.messageId,
    });

    const requestData = preparedRequest ?? {
      ...this.body,
      ...options.body,
      id: options.chatId,
      messages: options.messages,
      trigger: options.trigger,
      messageId: options.messageId,
      metadata: options.metadata ?? this.metadata,
    };

    // Create a ReadableStream that will receive data from IPC
    return new ReadableStream<UIMessageChunk>({
      start: async (controller) => {
        try {
          // Generate a unique stream ID for this request
          const streamId = `stream-${Date.now()}-${Math.random()}`;

          // Set up the IPC listener for this specific stream
          const handleChunk = (_event: any, data: any) => {
            if (data.streamId !== streamId) return;

            if (data.type === "chunk") {
              try {
                // Enqueue the chunk directly as UIMessageChunk
                if (data.chunk) {
                  controller.enqueue(data.chunk as UIMessageChunk);
                } else {
                  console.error("Invalid chunk format: missing chunk data");
                }
              } catch (error) {
                controller.error(error);
              }
            } else if (data.type === "error") {
              controller.error(new Error(data.error));
              window.ipcRenderer.off(
                `${this.sendChannel}:response`,
                handleChunk
              );
            } else if (data.type === "done") {
              controller.close();
              window.ipcRenderer.off(
                `${this.sendChannel}:response`,
                handleChunk
              );
            }
          };

          // Listen for responses
          window.ipcRenderer.on(`${this.sendChannel}:response`, handleChunk);

          // Send the request via IPC with the stream ID
          const response = await window.ipcRenderer.invoke(this.sendChannel, {
            ...requestData,
            streamId,
          });

          // Handle immediate errors
          if (!response.success) {
            controller.error(new Error(response.error));
            window.ipcRenderer.off(`${this.sendChannel}:response`, handleChunk);
          }
        } catch (error) {
          controller.error(error);
        }
      },

      cancel: () => {
        // Clean up any listeners if the stream is cancelled
        window.ipcRenderer.off(`${this.sendChannel}:response`, () => {});
      },
    });
  }

  async reconnectToStream(
    options: Parameters<ChatTransport<UI_MESSAGE>["reconnectToStream"]>[0]
  ): Promise<ReadableStream<UIMessageChunk> | null> {
    const preparedRequest = await this.prepareReconnectToStreamRequest?.({
      id: options.chatId,
      body: { ...this.body, ...options.body },
      requestMetadata: options.metadata ?? this.metadata,
    });

    const requestData = preparedRequest ?? {
      ...this.body,
      ...options.body,
      id: options.chatId,
      metadata: options.metadata ?? this.metadata,
    };

    try {
      const response = await window.ipcRenderer.invoke(
        this.reconnectChannel,
        requestData
      );

      if (!response.hasActiveStream) {
        return null;
      }

      // Create a new stream for reconnection
      return new ReadableStream<UIMessageChunk>({
        start: async (controller) => {
          const streamId = response.streamId;

          const handleChunk = (_event: any, data: any) => {
            if (data.streamId !== streamId) return;

            if (data.type === "chunk") {
              try {
                if (data.chunk) {
                  controller.enqueue(data.chunk as UIMessageChunk);
                } else {
                  console.error("Invalid chunk format: missing chunk data");
                }
              } catch (error) {
                controller.error(error);
              }
            } else if (data.type === "error") {
              controller.error(new Error(data.error));
              window.ipcRenderer.off(
                `${this.reconnectChannel}:response`,
                handleChunk
              );
            } else if (data.type === "done") {
              controller.close();
              window.ipcRenderer.off(
                `${this.reconnectChannel}:response`,
                handleChunk
              );
            }
          };

          window.ipcRenderer.on(
            `${this.reconnectChannel}:response`,
            handleChunk
          );
        },

        cancel: () => {
          window.ipcRenderer.off(`${this.reconnectChannel}:response`, () => {});
        },
      });
    } catch (error) {
      throw error;
    }
  }
}

// Type declaration for window.ipcRenderer
declare global {
  interface Window {
    ipcRenderer: {
      on: (
        channel: string,
        listener: (event: any, ...args: any[]) => void
      ) => void;
      off: (
        channel: string,
        listener: (event: any, ...args: any[]) => void
      ) => void;
      invoke: (channel: string, ...args: any[]) => Promise<any>;
    };
  }
}
