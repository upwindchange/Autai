import { openai } from "@ai-sdk/openai";
import { convertToCoreMessages, streamText } from "ai";
import { useAppStore } from "@/store/appStore";

export const maxDuration = 30;

import type { Message } from "ai";

export async function handleChatRequest(request: {
  messages: Message[];
  taskId?: string;
}) {
  const { messages, taskId } = request;
  const settings = useAppStore.getState().settings;

  if (!settings?.apiKey) {
    throw new Error("API key not configured");
  }

  // Create OpenAI provider with custom settings
  const provider = openai({
    apiKey: settings.apiKey,
    baseURL: settings.apiUrl || undefined,
  });

  const result = streamText({
    model: provider(settings.simpleModel || "gpt-4o-mini"),
    messages: convertToCoreMessages(messages),
    system: `You are a helpful AI assistant integrated into a web browser automation tool. 
             You can help users navigate web pages, answer questions about the current page content, 
             and provide assistance with browser automation tasks.
             ${taskId ? `Current task ID: ${taskId}` : ''}`,
  });

  return result.toDataStreamResponse();
}