"use client";

import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useChatRuntime } from "@assistant-ui/react-ai-sdk";
import { useThreadManager } from "./thread-manager";
import { useAppStore } from "@/store/appStore";
import { useState, useRef, useCallback } from "react";
import type { FC, PropsWithChildren } from "react";

interface TaskRuntimeProviderProps extends PropsWithChildren {
  taskId: string | null;
}

export const TaskRuntimeProvider: FC<TaskRuntimeProviderProps> = ({
  taskId,
  children,
}) => {
  const threadManager = useThreadManager();
  const createTask = useAppStore((state) => state.createTask);
  const [currentTaskId, setCurrentTaskId] = useState(taskId);
  const isCreatingTask = useRef(false);

  // Create a pending task ID for managing the thread before the actual task is created
  const pendingTaskId = useRef(`pending-${Date.now()}`).current;
  const effectiveTaskId = currentTaskId || pendingTaskId;

  // Get or create thread for this task
  let thread = threadManager.getThread(effectiveTaskId);
  if (!thread) {
    thread = threadManager.createThread({ taskId: effectiveTaskId });
  }

  // Callback to create task on first message
  const handleCreateTask = useCallback(async () => {
    if (!currentTaskId && !isCreatingTask.current) {
      isCreatingTask.current = true;
      try {
        // Create a new task
        await createTask("New Chat Task");
        
        // The task creation will update the store and should trigger a re-render
        // with the new taskId from the parent component
      } catch (error) {
        console.error("Failed to create task:", error);
        isCreatingTask.current = false;
      }
    }
  }, [currentTaskId, createTask]);

  // Create runtime using useChatRuntime - use the local API server
  const runtime = useChatRuntime({
    api: "http://localhost:3001/api/chat",
    body: {
      taskId: effectiveTaskId,
    },
    onBeforeSubmit: () => {
      // Create task on first message if needed
      handleCreateTask();
    },
  });

  // Update current task ID when prop changes
  if (taskId !== currentTaskId && taskId !== null) {
    setCurrentTaskId(taskId);
    isCreatingTask.current = false;
  }

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {children}
    </AssistantRuntimeProvider>
  );
};