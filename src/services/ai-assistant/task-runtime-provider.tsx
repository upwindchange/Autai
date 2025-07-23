"use client";

import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useChatRuntime } from "@assistant-ui/react-ai-sdk";
import type { FC, PropsWithChildren } from "react";

interface TaskRuntimeProviderProps extends PropsWithChildren {
  taskId: string | null;
}

export const TaskRuntimeProvider: FC<TaskRuntimeProviderProps> = ({
  taskId,
  children,
}) => {
  // Create runtime using useChatRuntime - use the local API server
  // When no task exists, use a placeholder that the backend can recognize
  const runtime = useChatRuntime({
    api: "http://localhost:3001/api/chat",
    body: {
      taskId: taskId || "no-task",
    },
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {children}
    </AssistantRuntimeProvider>
  );
};