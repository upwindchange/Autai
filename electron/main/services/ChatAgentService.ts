import { openai } from "@ai-sdk/openai";
import { streamText, convertToModelMessages, UIMessage } from "ai";
import { settingsService } from "./index";
import type { AISettings } from "../../shared/types/index";

export interface ChatStreamOptions {
  id: string;
  messages: UIMessage[];
  trigger: 'submit-user-message' | 'submit-tool-result' | 'regenerate-assistant-message';
  messageId?: string;
  metadata?: unknown;
  body?: Record<string, any>;
  streamId: string;
}

export interface ChatStreamChunk {
  streamId: string;
  type: 'chunk' | 'error' | 'done';
  chunk?: any;
  error?: string;
}

/**
 * Chat agent service using AI SDK v5 for streaming chat responses
 */
export class ChatAgentService {
  private activeStreams: Map<string, AbortController> = new Map();

  /**
   * Get the AI model configuration from settings
   */
  private getModelConfig(): { model: any; settings: AISettings } {
    const settings = settingsService.getActiveSettings();
    
    if (!settings || !settings.apiKey) {
      throw new Error("AI settings not configured. Please configure your API settings first.");
    }

    // Create OpenAI provider with custom configuration
    const model = openai(settings.simpleModel, {
      apiKey: settings.apiKey,
      baseURL: settings.apiUrl,
    });

    return { model, settings };
  }

  /**
   * Stream chat messages using AI SDK v5
   */
  async *streamChat(options: ChatStreamOptions): AsyncGenerator<ChatStreamChunk> {
    const abortController = new AbortController();
    this.activeStreams.set(options.streamId, abortController);

    try {
      const { model, settings } = this.getModelConfig();

      // Use streamText from AI SDK v5
      const result = streamText({
        model,
        messages: convertToModelMessages(options.messages),
        abortSignal: abortController.signal,
        // Add any additional settings
        maxTokens: 2048,
        temperature: 0.7,
      });

      // Stream the text chunks
      for await (const chunk of result.textStream) {
        yield {
          streamId: options.streamId,
          type: 'chunk',
          chunk: {
            type: 'text-part',
            id: `chunk-${Date.now()}`,
            text: chunk,
          },
        };
      }

      // Stream completed
      yield {
        streamId: options.streamId,
        type: 'done',
      };
    } catch (error) {
      // Handle errors
      if (error.name === 'AbortError') {
        yield {
          streamId: options.streamId,
          type: 'done',
        };
      } else {
        yield {
          streamId: options.streamId,
          type: 'error',
          error: error instanceof Error ? error.message : 'Unknown error occurred',
        };
      }
    } finally {
      // Clean up
      this.activeStreams.delete(options.streamId);
    }
  }

  /**
   * Check if a stream is active
   */
  hasActiveStream(chatId: string): { hasStream: boolean; streamId?: string } {
    // Find stream by checking if any streamId contains the chatId
    for (const [streamId, controller] of this.activeStreams.entries()) {
      if (streamId.includes(chatId) && !controller.signal.aborted) {
        return { hasStream: true, streamId };
      }
    }
    return { hasStream: false };
  }

  /**
   * Abort a specific stream
   */
  abortStream(streamId: string): void {
    const controller = this.activeStreams.get(streamId);
    if (controller && !controller.signal.aborted) {
      controller.abort();
      this.activeStreams.delete(streamId);
    }
  }

  /**
   * Abort all active streams
   */
  abortAllStreams(): void {
    for (const [streamId, controller] of this.activeStreams.entries()) {
      if (!controller.signal.aborted) {
        controller.abort();
      }
    }
    this.activeStreams.clear();
  }

  /**
   * Clean up resources
   */
  cleanup(): void {
    this.abortAllStreams();
  }
}