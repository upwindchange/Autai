import { useChat } from '@ai-sdk/react';
import { IPCChatTransport } from '@/lib/IPCChatTransport';
import { useLLMOutput } from '@llm-ui/react';
import { markdownLookBack } from '@llm-ui/markdown';
import { MarkdownBlock } from './ai-chat/blocks/markdown-block';
import { codeBlock } from './ai-chat/blocks/code-block';
import { errorBlock } from './ai-chat/blocks/error-block';
import { Send, Loader2, User, Bot, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { useEffect, useRef, useState } from 'react';
import { format } from 'date-fns';

/**
 * Example component demonstrating how to use the IPCChatTransport with useChat
 */
export function ChatExample() {
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isAutoScroll, setIsAutoScroll] = useState(true);

  const { messages, input, handleInputChange, handleSubmit, isLoading, stop } = useChat({
    // Use the custom IPC transport instead of the default HTTP transport
    transport: new IPCChatTransport({
      // Optional: customize channel names if needed
      sendChannel: 'chat:sendMessages',
      reconnectChannel: 'chat:reconnectToStream',
      
      // Optional: add metadata to all requests
      metadata: {
        userId: 'user-123',
        sessionId: 'session-456',
      },
      
      // Optional: transform request before sending
      prepareSendMessagesRequest: async ({ messages, ...options }) => {
        // You can filter or transform messages here
        return {
          ...options,
          messages: messages.slice(-10), // Only send last 10 messages
        };
      },
    }),
  });

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (isAutoScroll && scrollAreaRef.current) {
      const scrollContainer = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }
  }, [messages, isAutoScroll]);

  // Handle scroll events to detect if user has scrolled up
  const handleScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    const isAtBottom = Math.abs(element.scrollHeight - element.scrollTop - element.clientHeight) < 10;
    setIsAutoScroll(isAtBottom);
  };

  // Handle form submission
  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !isLoading) {
      handleSubmit(e);
      // Reset textarea height
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    }
  };

  // Auto-resize textarea
  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    handleInputChange(e);
    // Auto-resize
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
  };

  // Handle keyboard shortcuts
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSubmit(e);
    }
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="border-b px-6 py-4">
        <h2 className="text-lg font-semibold">AI Chat Example</h2>
        <p className="text-sm text-muted-foreground">
          Using AI SDK with custom IPC transport
        </p>
      </div>

      {/* Messages */}
      <ScrollArea 
        ref={scrollAreaRef} 
        className="flex-1 px-6 py-4"
        onScroll={handleScroll}
      >
        <div className="space-y-6 pb-4">
          {messages.length === 0 ? (
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
          ) : (
            messages.map((message) => (
              <MessageContent key={message.id} message={message} />
            ))
          )}
          
          {isLoading && (
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
                const scrollContainer = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
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
        <form onSubmit={onSubmit} className="relative">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            placeholder="Type your message... (Shift+Enter for new line)"
            className="min-h-[60px] max-h-[200px] pr-12 resize-none"
            disabled={isLoading}
            rows={1}
          />
          <div className="absolute bottom-2 right-2 flex items-center space-x-2">
            {isLoading ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={stop}
                className="h-8 px-3"
              >
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
                Stop
              </Button>
            ) : (
              <Button
                type="submit"
                size="sm"
                disabled={!input.trim()}
                className="h-8 px-3"
              >
                <Send className="h-4 w-4" />
              </Button>
            )}
          </div>
        </form>
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

/**
 * Message content component with llm-ui integration
 */
function MessageContent({ message }: { message: any }) {
  const [copied, setCopied] = useState(false);
  
  const { blockMatches } = useLLMOutput({
    llmOutput: message.content,
    blocks: [codeBlock, errorBlock],
    fallbackBlock: {
      component: MarkdownBlock,
      lookBack: markdownLookBack()
    },
    isStreamFinished: true
  });

  const isUser = message.role === 'user';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <div className={cn("flex items-start space-x-3", isUser && "flex-row-reverse space-x-reverse")}>
      <Avatar className="h-8 w-8 flex-shrink-0">
        <AvatarFallback className={cn(
          isUser ? "bg-primary text-primary-foreground" : "bg-primary/10"
        )}>
          {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
        </AvatarFallback>
      </Avatar>
      
      <div className={cn("flex-1 space-y-2", isUser && "flex flex-col items-end")}>
        <div className={cn(
          "flex items-center space-x-2 text-sm text-muted-foreground",
          isUser && "flex-row-reverse space-x-reverse"
        )}>
          <span className="font-medium">{isUser ? 'You' : 'Assistant'}</span>
          <span>•</span>
          <span>{message.createdAt ? format(new Date(message.createdAt), 'HH:mm') : format(new Date(), 'HH:mm')}</span>
        </div>
        
        <Card className={cn(
          "relative group",
          isUser ? "bg-primary text-primary-foreground" : "bg-card"
        )}>
          <div className={cn(
            "px-4 py-3",
            isUser ? "prose-invert" : ""
          )}>
            {isUser ? (
              <p className="text-sm whitespace-pre-wrap">{message.content}</p>
            ) : (
              <div className="prose prose-sm max-w-none dark:prose-invert">
                {blockMatches.map((match, i) => {
                  const Component = match.block.component;
                  return <Component key={i} blockMatch={match} />;
                })}
              </div>
            )}
          </div>
          
          {/* Copy button */}
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "absolute top-2 right-2 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity",
              isUser && "hover:bg-primary-foreground/20"
            )}
            onClick={handleCopy}
          >
            {copied ? (
              <Check className="h-3 w-3" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
          </Button>
        </Card>
      </div>
    </div>
  );
}