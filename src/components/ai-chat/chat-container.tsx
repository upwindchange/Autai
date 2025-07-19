import { Bot } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageList } from "./message-list";
import { InputBox } from "./input-box";
import { useTaskChat } from "./hooks/use-task-chat";
import type { ChatContainerProps } from "./types";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * Main chat container that manages task-specific conversations
 */
export function ChatContainer({ taskId }: ChatContainerProps) {
  const { messages, sendMessage, isStreaming } = useTaskChat(taskId);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const [isAutoScroll, setIsAutoScroll] = useState(true);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (isAutoScroll && scrollAreaRef.current) {
      const scrollContainer = scrollAreaRef.current.querySelector(
        "[data-radix-scroll-area-viewport]"
      );
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }
  }, [messages, isAutoScroll]);

  // Handle scroll events to detect if user has scrolled up
  const handleScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    const isAtBottom =
      Math.abs(
        element.scrollHeight - element.scrollTop - element.clientHeight
      ) < 10;
    setIsAutoScroll(isAtBottom);
  };

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
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="border-b px-6 py-4">
        <h2 className="text-lg font-semibold">AI Assistant</h2>
        <p className="text-sm text-muted-foreground">Task: {taskId}</p>
      </div>

      {/* Messages */}
      <ScrollArea
        ref={scrollAreaRef}
        className="flex-1 px-6 py-4 overflow-y-auto"
        onScroll={handleScroll}
      >
        <div className="pb-4">
          <MessageList messages={messages} taskId={taskId} />
        </div>
      </ScrollArea>

      {/* Scroll to bottom indicator */}
      {!isAutoScroll && (
        <div className="absolute bottom-24 right-8">
          <Button
            variant="secondary"
            size="sm"
            className="rounded-full shadow-md"
            onClick={() => {
              setIsAutoScroll(true);
              if (scrollAreaRef.current) {
                const scrollContainer = scrollAreaRef.current.querySelector(
                  "[data-radix-scroll-area-viewport]"
                );
                if (scrollContainer) {
                  scrollContainer.scrollTop = scrollContainer.scrollHeight;
                }
              }
            }}
          >
            ↓ Scroll to bottom
          </Button>
        </div>
      )}

      {/* Input form */}
      <div className="border-t p-4">
        <InputBox
          onSend={sendMessage}
          disabled={isStreaming}
          placeholder="Type your message... (Shift+Enter for new line)"
        />
        <div className="flex items-center justify-between mt-2">
          <p className="text-xs text-muted-foreground">
            Press Enter to send, Shift+Enter for new line
          </p>
          <p className="text-xs text-muted-foreground">
            {messages.length} messages
          </p>
        </div>
      </div>
    </div>
  );
}
