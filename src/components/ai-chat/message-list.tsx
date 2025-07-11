import { MessageItem } from "./message-item";
import type { MessageListProps } from "./types";

/**
 * Component that displays a list of chat messages
 */
export function MessageList({ messages }: MessageListProps) {
  if (messages.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-8">
        <p>No messages yet. Start a conversation!</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {messages.map((message) => (
        <MessageItem key={message.id} message={message} />
      ))}
    </div>
  );
}
