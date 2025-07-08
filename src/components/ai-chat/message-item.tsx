import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useLLMOutput } from '@llm-ui/react';
import { markdownLookBack } from '@llm-ui/markdown';
import { MarkdownBlock } from './blocks/markdown-block';
import { codeBlock } from './blocks/code-block';
import { errorBlock } from './blocks/error-block';
import { User, Bot, AlertCircle } from 'lucide-react';
import type { MessageItemProps } from "./types";

/**
 * Individual message component with llm-ui integration
 */
export function MessageItem({ message }: MessageItemProps) {
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

  return (
    <div className={cn("flex gap-3", isUser && "flex-row-reverse")}>
      <Avatar className="h-8 w-8 shrink-0">
        <AvatarFallback className={cn(
          "text-xs",
          isUser && "bg-primary text-primary-foreground",
          isError && "bg-destructive text-destructive-foreground"
        )}>
          {isUser ? <User className="h-4 w-4" /> : isError ? <AlertCircle className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
        </AvatarFallback>
      </Avatar>
      
      <Card className={cn(
        "max-w-[80%]",
        isUser && "bg-primary text-primary-foreground",
        isError && "border-destructive"
      )}>
        <CardContent className="p-3">
          {!message.isComplete && message.sender === 'assistant' && message.content === '' && (
            <div className="space-y-2">
              <Skeleton className="h-4 w-[200px]" />
              <Skeleton className="h-4 w-[150px]" />
            </div>
          )}
          
          <div className={cn(
            "prose prose-sm max-w-none",
            isUser && "prose-invert",
            !isUser && "dark:prose-invert"
          )}>
            {blockMatches.map((match, i) => {
              const Component = match.block.component;
              return <Component key={i} blockMatch={match} />;
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}