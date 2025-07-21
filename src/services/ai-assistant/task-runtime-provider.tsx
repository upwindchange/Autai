"use client";

import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useChatRuntime } from "@assistant-ui/react-ai-sdk";
import { useThreadManager } from "./thread-manager";
import { handleChatRequest } from "./api-handler";
import type { FC, PropsWithChildren } from "react";
import type { Message } from "ai";

interface TaskRuntimeProviderProps extends PropsWithChildren {
  taskId: string;
}

export const TaskRuntimeProvider: FC<TaskRuntimeProviderProps> = ({
  taskId,
  children,
}) => {
  const threadManager = useThreadManager();

  // Get or create thread for this task
  let thread = threadManager.getThread(taskId);
  if (!thread) {
    thread = threadManager.createThread({ taskId });
  }

  // Create runtime using useChatRuntime with custom API handler
  const runtime = useChatRuntime({
    api: async (messages: Message[]) => {
      // Since we're in Electron, we handle the request directly
      // instead of making an HTTP request
      const response = await handleChatRequest({
        messages,
        taskId,
      });
      return response;
    },
    id: `chat-${taskId}`,
    initialMessages: thread.messages,
    onError: (error) => {
      console.error("Chat error:", error);
      threadManager.updateThread(taskId, { error: error as Error });
    },
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {children}
    </AssistantRuntimeProvider>
  );
};