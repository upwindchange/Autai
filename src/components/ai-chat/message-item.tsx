import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useLLMOutput } from '@llm-ui/react';
import { markdownLookBack } from '@llm-ui/markdown';
import { MarkdownBlock } from './blocks/markdown-block';
import { codeBlock } from './blocks/code-block';
import { errorBlock } from './blocks/error-block';
import { User, Bot, AlertCircle, Copy, Check } from 'lucide-react';
import { format } from 'date-fns';
import { useState } from 'react';
import type { MessageItemProps } from "./types";

/**
 * Individual message component with llm-ui integration
 */
export function MessageItem({ message }: MessageItemProps) {
  const [copied, setCopied] = useState(false);
  
  const { blockMatches } = useLLMOutput({
    llmOutput: message.content,
    blocks: [codeBlock, errorBlock],
    fallbackBlock: {
      component: MarkdownBlock,
      lookBack: markdownLookBack()
    },
    isStreamFinished: message.isComplete
  });

  const isUser = message.sender === 'user';
  const isError = message.sender === 'system' || !!message.error;

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
          isUser ? "bg-primary text-primary-foreground" : isError ? "bg-destructive text-destructive-foreground" : "bg-primary/10"
        )}>
          {isUser ? <User className="h-4 w-4" /> : isError ? <AlertCircle className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
        </AvatarFallback>
      </Avatar>
      
      <div className={cn("flex-1 space-y-2", isUser && "flex flex-col items-end")}>
        <div className={cn(
          "flex items-center space-x-2 text-sm text-muted-foreground",
          isUser && "flex-row-reverse space-x-reverse"
        )}>
          <span className="font-medium">{isUser ? 'You' : isError ? 'System' : 'Assistant'}</span>
          <span>•</span>
          <span>{message.timestamp ? format(new Date(message.timestamp), 'HH:mm') : format(new Date(), 'HH:mm')}</span>
        </div>
        
        <Card className={cn(
          "relative group",
          isUser ? "bg-primary text-primary-foreground" : isError ? "border-destructive" : "bg-card"
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