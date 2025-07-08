import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageList } from "./message-list";
import { InputBox } from "./input-box";
import { useTaskChat } from "./hooks/use-task-chat";
import type { ChatContainerProps } from "./types";

/**
 * Main chat container that manages task-specific conversations
 */
export function ChatContainer({ taskId, activeViewKey }: ChatContainerProps) {
  const { messages, sendMessage, isStreaming } = useTaskChat(taskId);

  if (!taskId) {
    return (
      <Card className="h-full flex items-center justify-center p-8">
        <div className="text-center space-y-2">
          <p className="text-muted-foreground">Select a task to start chatting</p>
          <p className="text-sm text-muted-foreground">Each task has its own AI assistant</p>
        </div>
      </Card>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="border-b px-4 py-3">
        <h3 className="font-semibold">AI Assistant</h3>
        <p className="text-sm text-muted-foreground">Task: {taskId}</p>
      </div>
      
      <ScrollArea className="flex-1">
        <div className="p-4">
          <MessageList messages={messages} taskId={taskId} />
        </div>
      </ScrollArea>
      
      <div className="border-t p-4">
        <InputBox 
          onSend={sendMessage} 
          disabled={isStreaming}
          placeholder={`Ask about this task...`}
        />
      </div>
    </div>
  );
}