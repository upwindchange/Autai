import {
  ActionBarPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
} from "@assistant-ui/react";
import type { FC } from "react";
import { useRef, useEffect } from "react";
import {
  ArrowDownIcon,
  CheckIcon,
  CircleStopIcon,
  CopyIcon,
  PencilIcon,
  RefreshCwIcon,
  SendHorizontalIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { MarkdownText } from "@/components/assistant-ui/markdown-text";
import { ToolFallback } from "@/components/assistant-ui/tool-fallback";
import { CalculatorTool, AnswerTool, DisplayErrorTool } from "@/components/assistant-ui/tool-components";
import { TOOL_NAMES } from "@shared/index";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { useUiStore } from "@/stores/uiStore";
import { useViewVisibility } from "@/hooks/useViewVisibility";

interface ThreadProps {
  showSplitView?: boolean;
}

export const Thread: FC<ThreadProps> = ({ showSplitView = false }) => {
  const workspaceRef = useRef<HTMLDivElement>(null);
  const { setContainerRef, setContainerBounds } = useUiStore();
  
  // Sync view visibility with container state
  useViewVisibility();

  useEffect(() => {
    if (showSplitView && workspaceRef.current) {
      setContainerRef(workspaceRef.current);
      
      // Set initial bounds
      const rect = workspaceRef.current.getBoundingClientRect();
      setContainerBounds({ width: rect.width, height: rect.height });

      // Set up resize observer
      const resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width, height } = entry.contentRect;
          setContainerBounds({ width, height });
        }
      });
      
      resizeObserver.observe(workspaceRef.current);

      return () => {
        resizeObserver.disconnect();
        setContainerRef(null);
        setContainerBounds(null);
      };
    } else {
      // Clean up when not in split view
      setContainerRef(null);
      setContainerBounds(null);
    }
  }, [showSplitView, setContainerRef, setContainerBounds]);

  return (
    <ThreadPrimitive.Root className="bg-background flex h-full flex-col">
      {showSplitView ? (
        <ResizablePanelGroup direction="horizontal" className="flex-1">
          <ResizablePanel defaultSize={50} minSize={30}>
            <ThreadPrimitive.Viewport className="h-full overflow-y-auto">
              <div className="mx-auto max-w-3xl px-4 pb-12">
                <ThreadWelcome />

                <ThreadPrimitive.Messages
                  components={{
                    UserMessage,
                    AssistantMessage,
                    EditComposer,
                  }}
                />
              </div>
            </ThreadPrimitive.Viewport>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={50} minSize={30}>
            <div ref={workspaceRef} className="h-full bg-muted/30 flex items-center justify-center text-muted-foreground border-r">
              <p>Workspace Area</p>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        <ThreadPrimitive.Viewport className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-4 pb-12">
            <ThreadWelcome />

            <ThreadPrimitive.Messages
              components={{
                UserMessage,
                AssistantMessage,
                EditComposer,
              }}
            />
          </div>
        </ThreadPrimitive.Viewport>
      )}

      <div className="border-t bg-background p-4">
        <div className="mx-auto max-w-3xl">
          <Composer />
        </div>
      </div>

      <ThreadScrollToBottom />
    </ThreadPrimitive.Root>
  );
};

const ThreadWelcome: FC = () => {
  return (
    <ThreadPrimitive.Empty>
      <div className="flex h-[50vh] flex-col items-center justify-center text-center">
        <h1 className="text-2xl font-semibold mb-2">
          How can I help you today?
        </h1>
        <p className="text-muted-foreground">Start a conversation to begin</p>
      </div>
    </ThreadPrimitive.Empty>
  );
};

const ThreadScrollToBottom: FC = () => {
  return (
    <ThreadPrimitive.ScrollToBottom asChild>
      <TooltipIconButton
        tooltip="Scroll to bottom"
        variant="outline"
        className="absolute bottom-24 right-4 rounded-full shadow-md disabled:invisible"
      >
        <ArrowDownIcon className="size-4" />
      </TooltipIconButton>
    </ThreadPrimitive.ScrollToBottom>
  );
};

const Composer: FC = () => {
  return (
    <ComposerPrimitive.Root className="flex items-end gap-2 rounded-lg border bg-background p-2">
      <ComposerPrimitive.Input
        autoFocus
        placeholder="Type a message..."
        className="min-h-12 flex-1 resize-none bg-transparent px-3 py-3 text-sm outline-none placeholder:text-muted-foreground"
      />
      <ThreadPrimitive.If running={false}>
        <ComposerPrimitive.Send asChild>
          <TooltipIconButton
            tooltip="Send message"
            variant="default"
            size="icon"
            className="size-9"
          >
            <SendHorizontalIcon className="size-4" />
          </TooltipIconButton>
        </ComposerPrimitive.Send>
      </ThreadPrimitive.If>
      <ThreadPrimitive.If running>
        <ComposerPrimitive.Cancel asChild>
          <TooltipIconButton
            tooltip="Stop generating"
            variant="default"
            size="icon"
            className="size-9"
          >
            <CircleStopIcon className="size-4" />
          </TooltipIconButton>
        </ComposerPrimitive.Cancel>
      </ThreadPrimitive.If>
    </ComposerPrimitive.Root>
  );
};

const UserMessage: FC = () => {
  return (
    <MessagePrimitive.Root className="mb-6 flex flex-col items-end">
      <div className="group relative max-w-[80%] rounded-lg bg-primary px-4 py-2 text-primary-foreground">
        <MessagePrimitive.Parts />
        <UserActionBar />
      </div>
    </MessagePrimitive.Root>
  );
};

const UserActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="absolute -left-10 top-0 flex flex-col gap-1"
    >
      <ActionBarPrimitive.Edit asChild>
        <TooltipIconButton
          tooltip="Edit"
          variant="ghost"
          className="size-8 opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <PencilIcon className="size-4" />
        </TooltipIconButton>
      </ActionBarPrimitive.Edit>
    </ActionBarPrimitive.Root>
  );
};

const EditComposer: FC = () => {
  return (
    <ComposerPrimitive.Root className="mb-4 rounded-lg border bg-muted p-3">
      <ComposerPrimitive.Input className="min-h-20 w-full resize-none bg-transparent outline-none" />
      <div className="mt-2 flex justify-end gap-2">
        <ComposerPrimitive.Cancel asChild>
          <Button variant="ghost" size="sm">
            Cancel
          </Button>
        </ComposerPrimitive.Cancel>
        <ComposerPrimitive.Send asChild>
          <Button size="sm">Update</Button>
        </ComposerPrimitive.Send>
      </div>
    </ComposerPrimitive.Root>
  );
};

const AssistantMessage: FC = () => {
  return (
    <MessagePrimitive.Root className="mb-6 flex flex-col items-start">
      <div className="group relative max-w-[80%] rounded-lg border bg-card px-4 py-2">
        <MessagePrimitive.Parts 
          components={{ 
            Text: MarkdownText,
            tools: {
              by_name: {
                [TOOL_NAMES.CALCULATE]: CalculatorTool,
                [TOOL_NAMES.ANSWER]: AnswerTool,
                [TOOL_NAMES.DISPLAY_ERROR]: DisplayErrorTool,
              },
              Fallback: ToolFallback,
            }
          }} 
        />
        <AssistantActionBar />
      </div>
    </MessagePrimitive.Root>
  );
};

const AssistantActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="absolute -right-10 top-0 flex flex-col gap-1"
    >
      <ActionBarPrimitive.Copy asChild>
        <TooltipIconButton
          tooltip="Copy"
          variant="ghost"
          className="size-8 opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <MessagePrimitive.If copied>
            <CheckIcon className="size-4" />
          </MessagePrimitive.If>
          <MessagePrimitive.If copied={false}>
            <CopyIcon className="size-4" />
          </MessagePrimitive.If>
        </TooltipIconButton>
      </ActionBarPrimitive.Copy>
      <ActionBarPrimitive.Reload asChild>
        <TooltipIconButton
          tooltip="Regenerate"
          variant="ghost"
          className="size-8 opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <RefreshCwIcon className="size-4" />
        </TooltipIconButton>
      </ActionBarPrimitive.Reload>
    </ActionBarPrimitive.Root>
  );
};
