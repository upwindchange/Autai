import { createOpenAI } from "@ai-sdk/openai";
import { convertToCoreMessages, streamText } from "ai";
import type { Message } from "ai";

export const maxDuration = 30;

export async function handleChatRequest(request: {
  messages: Message[];
  taskId?: string;
  settings?: {
    apiKey: string;
    apiUrl?: string;
    simpleModel?: string;
    complexModel?: string;
  };
}) {
  const { messages, taskId, settings } = request;

  if (!settings?.apiKey) {
    throw new Error("API key not configured");
  }

  // Create OpenAI provider with custom settings
  const openai = createOpenAI({
    apiKey: settings.apiKey,
    baseURL: settings.apiUrl || undefined,
  });

  const result = streamText({
    model: openai(settings.simpleModel || "gpt-4o-mini"),
    messages: convertToCoreMessages(messages),
    system: `You are a helpful AI assistant integrated into a web browser automation tool. 
             You can help users navigate web pages, answer questions about the current page content, 
             and provide assistance with browser automation tasks.
             ${taskId ? `Current task ID: ${taskId}` : ''}`,
  });

  return result.toDataStreamResponse();
}