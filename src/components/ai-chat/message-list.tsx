import { MessageItem } from "./message-item";
import { Bot, Loader2 } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { format } from "date-fns";
import type { MessageListProps } from "./types";

/**
 * Component that displays a list of chat messages
 */
export function MessageList({ messages }: MessageListProps) {
  const isStreaming = messages.length > 0 && !messages[messages.length - 1].isComplete;

  if (messages.length === 0) {
    return (
      <div className="flex items-center justify-center h-full min-h-[200px]">
        <div className="text-center space-y-3">
          <Bot className="h-12 w-12 text-muted-foreground mx-auto" />
          <div>
            <h3 className="font-medium text-lg">Start a conversation</h3>
            <p className="text-sm text-muted-foreground">
              Type a message below to begin chatting with the AI assistant
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {messages.map((message) => (
        <MessageItem key={message.id} message={message} />
      ))}
      
      {isStreaming && messages[messages.length - 1].content === '' && (
        <div className="flex items-start space-x-3">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="bg-primary/10">
              <Bot className="h-4 w-4" />
            </AvatarFallback>
          </Avatar>
          <div className="flex-1">
            <div className="flex items-center space-x-2 text-sm text-muted-foreground mb-1">
              <span className="font-medium">Assistant</span>
              <span>•</span>
              <span>{format(new Date(), 'HH:mm')}</span>
            </div>
            <Card className="inline-flex items-center space-x-2 px-4 py-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Thinking...</span>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
