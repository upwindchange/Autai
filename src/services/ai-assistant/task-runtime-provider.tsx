"use client";

import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useChatRuntime } from "@assistant-ui/react-ai-sdk";
import { useThreadManager } from "./thread-manager";
import type { FC, PropsWithChildren } from "react";

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

  // Create runtime using useChatRuntime - use the local API server
  const runtime = useChatRuntime({
    api: "http://localhost:3001/api/chat",
    body: {
      taskId,
    },
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {children}
    </AssistantRuntimeProvider>
  );
};