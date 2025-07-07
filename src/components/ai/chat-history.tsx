import { ScrollArea } from "@/components/ui/scroll-area";
import { ChatMessage } from "./chat-interface";
import { cn } from "@/lib/utils";

interface ChatHistoryProps {
  messages: ChatMessage[];
  isLoading: boolean;
}

export function ChatHistory({ messages, isLoading }: ChatHistoryProps) {
  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-4 p-4">
        {messages.map((message) => (
          <div
            key={message.id}
            className={cn(
              "flex flex-col gap-2 max-w-[80%]",
              message.sender === 'user' ? "self-end" : "self-start"
            )}
          >
            <div
              className={cn(
                "px-4 py-2 rounded-lg",
                message.sender === 'user'
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted"
              )}
            >
              <p className="text-sm whitespace-pre-wrap">{message.text}</p>
            </div>
            <span className="text-xs text-muted-foreground">
              {message.timestamp.toLocaleTimeString()}
            </span>
          </div>
        ))}
        {isLoading && (
          <div className="flex items-center gap-2 self-start">
            <div className="flex gap-1">
              <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" />
              <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce delay-100" />
              <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce delay-200" />
            </div>
            <span className="text-sm text-muted-foreground">AI is thinking...</span>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}