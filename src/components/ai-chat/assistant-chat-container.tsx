import { Thread } from "@/components/assistant-ui/thread";
import { TaskRuntimeProvider } from "@/services/ai-assistant/task-runtime-provider";
import type { FC } from "react";

interface AssistantChatContainerProps {
  taskId: string | null;
}

export const AssistantChatContainer: FC<AssistantChatContainerProps> = ({
  taskId,
}) => {
  return (
    <TaskRuntimeProvider taskId={taskId}>
      <Thread />
    </TaskRuntimeProvider>
  );
};