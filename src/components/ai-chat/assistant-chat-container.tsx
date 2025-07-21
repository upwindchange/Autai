import { Bot } from "lucide-react";
import { Thread } from "@/components/assistant-ui/thread";
import { TaskRuntimeProvider } from "@/services/ai-assistant/task-runtime-provider";
import type { FC } from "react";

interface AssistantChatContainerProps {
  taskId: string | null;
}

export const AssistantChatContainer: FC<AssistantChatContainerProps> = ({
  taskId,
}) => {
  if (!taskId) {
    return (
      <div className="flex flex-col h-full bg-background">
        <div className="flex items-center justify-center h-full">
          <div className="text-center space-y-3">
            <Bot className="h-12 w-12 text-muted-foreground mx-auto" />
            <div>
              <h3 className="font-medium text-lg">
                Select a task to start chatting
              </h3>
              <p className="text-sm text-muted-foreground">
                Each task has its own AI assistant
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <TaskRuntimeProvider taskId={taskId}>
      <Thread />
    </TaskRuntimeProvider>
  );
};