import type { FC } from "react";
import {
  ThreadListItemPrimitive,
  ThreadListPrimitive,
} from "@assistant-ui/react";
import { MessageSquareIcon, PlusIcon, ArchiveIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { cn } from "@/lib/utils";

export const ThreadList: FC = () => {
  return (
    <ThreadListPrimitive.Root className="flex h-full flex-col">
      <ThreadListHeader />
      <ThreadListNew />
      <ThreadListItems />
    </ThreadListPrimitive.Root>
  );
};

const ThreadListHeader: FC = () => {
  return (
    <div className="flex items-center gap-2 px-4 py-3 border-b">
      <MessageSquareIcon className="size-4 text-muted-foreground" />
      <h2 className="text-sm font-semibold">Conversations</h2>
    </div>
  );
};

const ThreadListNew: FC = () => {
  return (
    <div className="px-3 py-2">
      {/* Thread management not yet supported in AI SDK v5 alpha
      <ThreadListPrimitive.New asChild>
        <Button variant="outline" className="w-full justify-start gap-2 h-9">
          <PlusIcon className="size-4" />
          New Conversation
        </Button>
      </ThreadListPrimitive.New>
      */}
      <div className="text-xs text-muted-foreground px-3 py-2">
        Thread management coming soon...
      </div>
    </div>
  );
};

const ThreadListItems: FC = () => {
  return (
    <div className="flex-1 overflow-y-auto px-3 pb-3">
      <ThreadListPrimitive.Items components={{ ThreadListItem }} />
    </div>
  );
};

const ThreadListItem: FC = () => {
  return (
    <ThreadListItemPrimitive.Root
      className={cn(
        "group relative flex items-center gap-3 rounded-lg px-3 py-2.5",
        "hover:bg-accent/50 transition-colors duration-150",
        "data-[active]:bg-accent data-[active]:shadow-sm",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
      )}
    >
      <MessageSquareIcon className="size-4 text-muted-foreground shrink-0" />

      <ThreadListItemPrimitive.Trigger className="flex-1 min-w-0">
        <ThreadListItemTitle />
      </ThreadListItemPrimitive.Trigger>

      <ThreadListItemActions />
    </ThreadListItemPrimitive.Root>
  );
};

const ThreadListItemTitle: FC = () => {
  return (
    <p className="text-sm truncate">
      <ThreadListItemPrimitive.Title fallback="New Conversation" />
    </p>
  );
};

const ThreadListItemActions: FC = () => {
  return (
    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
      {/* Archive not yet supported in AI SDK v5 alpha
      <ThreadListItemPrimitive.Archive asChild>
        <TooltipIconButton
          size="icon"
          variant="ghost"
          className="size-7 text-muted-foreground hover:text-foreground"
          tooltip="Archive conversation"
        >
          <ArchiveIcon className="size-3.5" />
        </TooltipIconButton>
      </ThreadListItemPrimitive.Archive>
      */}
    </div>
  );
};
