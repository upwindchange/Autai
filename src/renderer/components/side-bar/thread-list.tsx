import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AuiIf,
  ThreadListItemPrimitive,
  ThreadListPrimitive,
  useAui,
  useAuiState,
} from "@assistant-ui/react";
import {
  ArchiveIcon,
  BookmarkIcon,
  ChevronRightIcon,
  MoreHorizontalIcon,
  PlusIcon,
  TrashIcon,
  XIcon,
} from "lucide-react";
import { useMemo, useState, type FC } from "react";
import { useTagStore, type ThreadInfo } from "@/stores/tagStore";
import { getTagColor } from "@/components/side-bar/tag-filter";
import { addTagToThread, removeTagFromThread } from "@/lib/tagApi";
import type { TagRow } from "@shared/tag";

export const ThreadList: FC = () => {
  const viewMode = useTagStore((s) => s.viewMode);
  const selectedTagId = useTagStore((s) => s.selectedTagId);

  return (
    <ThreadListPrimitive.Root className="aui-root aui-thread-list-root flex flex-col gap-1">
      <ThreadListNew />
      <AuiIf condition={(s) => s.threads.isLoading}>
        <ThreadListSkeleton />
      </AuiIf>
      <AuiIf condition={(s) => !s.threads.isLoading}>
        {viewMode === "grouped" ?
          <GroupedThreadList selectedTagId={selectedTagId} />
        : <FlatThreadList selectedTagId={selectedTagId} />}
      </AuiIf>
    </ThreadListPrimitive.Root>
  );
};

// ---------------------------------------------------------------------------
// Flat thread list (with tag filter)
// ---------------------------------------------------------------------------

const FlatThreadList: FC<{ selectedTagId: number | null }> = ({
  selectedTagId,
}) => {
  return (
    <ThreadListPrimitive.Items>
      {() => {
        // Filter is handled by checking tags inside ThreadListItem
        return <ThreadListItem selectedTagId={selectedTagId} />;
      }}
    </ThreadListPrimitive.Items>
  );
};

// ---------------------------------------------------------------------------
// Grouped thread list (threads organized by tag in collapsible sections)
// ---------------------------------------------------------------------------

interface TagGroup {
  tagName: string;
  tagColor: string;
  threads: ThreadInfo[];
}

const GroupedThreadList: FC<{ selectedTagId: number | null }> = ({
  selectedTagId,
}) => {
  const aui = useAui();
  const mainThreadId = useAuiState((s) => s.threads.mainThreadId);
  const threads = useTagStore((s) => s.threads);
  const allTags = useTagStore((s) => s.tags);

  // Group threads by tag
  const { tagGroups, untagged } = useMemo(() => {
    const groupMap = new Map<number, TagGroup>();
    const untaggedList: ThreadInfo[] = [];

    for (const thread of threads) {
      if (
        selectedTagId !== null &&
        !thread.tags.some((t) => t.id === selectedTagId)
      ) {
        continue;
      }

      if (thread.tags.length === 0) {
        untaggedList.push(thread);
      } else {
        // Use first tag for grouping
        const primaryTag = thread.tags[0]!;
        if (!groupMap.has(primaryTag.id)) {
          groupMap.set(primaryTag.id, {
            tagName: primaryTag.name,
            tagColor: getTagColor(primaryTag.id),
            threads: [],
          });
        }
        groupMap.get(primaryTag.id)!.threads.push(thread);
      }
    }

    // Sort groups to match tag sort_order
    const tagGroups = allTags
      .filter((t) => groupMap.has(t.id))
      .map((t) => groupMap.get(t.id)!)
      .filter(Boolean);

    return { tagGroups, untagged: untaggedList };
  }, [threads, allTags, selectedTagId]);

  return (
    <div className="flex flex-col gap-1">
      {tagGroups.map((group) => (
        <CollapsibleTagGroup
          key={group.tagName}
          group={group}
          activeThreadId={mainThreadId}
          onSwitch={(threadId) => aui.threads().switchToThread(threadId)}
        />
      ))}
      {untagged.length > 0 && (
        <CollapsibleTagGroup
          group={{
            tagName: "Untagged",
            tagColor: "bg-muted text-muted-foreground",
            threads: untagged,
          }}
          activeThreadId={mainThreadId}
          onSwitch={(threadId) => aui.threads().switchToThread(threadId)}
        />
      )}
    </div>
  );
};

const CollapsibleTagGroup: FC<{
  group: TagGroup;
  activeThreadId: string;
  onSwitch: (threadId: string) => void;
}> = ({ group, activeThreadId, onSwitch }) => {
  const [open, setOpen] = useState(true);

  return (
    <div className="flex flex-col">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold text-muted-foreground hover:bg-muted"
      >
        <ChevronRightIcon
          className={`size-3 transition-transform ${open ? "rotate-90" : ""}`}
        />
        <span
          className={`rounded px-1.5 py-0 text-[10px] font-medium ${group.tagColor}`}
        >
          {group.tagName}
        </span>
        <span className="text-[10px] font-normal">
          ({group.threads.length})
        </span>
      </button>
      {open && (
        <div className="ml-2 flex flex-col gap-0.5 border-l pl-2">
          {group.threads.map((thread) => (
            <button
              key={thread.remoteId}
              onClick={() => onSwitch(thread.remoteId)}
              className={`flex min-h-9 items-center gap-2 rounded-lg px-3 py-1 text-start text-sm transition-colors hover:bg-muted ${activeThreadId === thread.remoteId ? "bg-muted" : ""}`}
            >
              <span className="min-w-0 flex-1 truncate">
                {thread.title ?? "New Chat"}
              </span>
              {thread.tags.map((tag) => (
                <span
                  key={tag.id}
                  className={`inline-flex rounded px-1 py-0 text-[10px] font-medium ${getTagColor(tag.id)}`}
                >
                  {tag.name}
                </span>
              ))}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// New thread button
// ---------------------------------------------------------------------------

const ThreadListNew: FC = () => {
  return (
    <ThreadListPrimitive.New asChild>
      <Button
        variant="outline"
        className="aui-thread-list-new h-9 justify-start gap-2 rounded-lg px-3 text-sm hover:bg-muted data-active:bg-muted"
      >
        <PlusIcon className="size-4" />
        New Conversation
      </Button>
    </ThreadListPrimitive.New>
  );
};

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

const ThreadListSkeleton: FC = () => {
  return (
    <div className="flex flex-col gap-1">
      {Array.from({ length: 5 }, (_, i) => (
        <div
          key={i}
          role="status"
          aria-label="Loading threads"
          className="aui-thread-list-skeleton-wrapper flex h-9 items-center px-3"
        >
          <Skeleton className="aui-thread-list-skeleton h-4 w-full" />
        </div>
      ))}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Thread list item with inline tag chips
// ---------------------------------------------------------------------------

const ThreadListItem: FC<{ selectedTagId?: number | null }> = ({
  selectedTagId = null,
}) => {
  const remoteId = useAuiState((s) => s.threadListItem.remoteId);
  const threadTags = useTagStore((s) =>
    remoteId ? (s.threadTags[remoteId] ?? []) : [],
  );

  // Filter by selected tag
  if (
    selectedTagId !== null &&
    !threadTags.some((t) => t.id === selectedTagId)
  ) {
    return null;
  }

  return (
    <ThreadListItemPrimitive.Root className="aui-thread-list-item group/thread relative flex min-h-9 items-center gap-2 rounded-lg border border-transparent px-2 py-0.5 transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none data-active:border-l-2 data-active:border-primary data-active:bg-accent">
      <ThreadListItemPrimitive.Trigger className="aui-thread-list-item-trigger relative flex min-w-0 flex-1 flex-col items-start px-1 py-1 text-start text-sm">
        <div className="flex w-full items-center">
          <span className="aui-thread-list-item-title min-w-0 flex-1 truncate">
            <ThreadListItemPrimitive.Title fallback="New Chat" />
          </span>
          <span className="pointer-events-none absolute right-0 top-0 h-6 w-8 shrink-0 bg-linear-to-l from-(--sidebar-background) to-transparent" />
        </div>
        <div className="flex flex-wrap items-center gap-0.5">
          {threadTags.map((tag) => (
            <ThreadTagChip key={tag.id} tag={tag} threadRemoteId={remoteId} />
          ))}
        </div>
      </ThreadListItemPrimitive.Trigger>
      <ThreadListItemMore threadRemoteId={remoteId} />
    </ThreadListItemPrimitive.Root>
  );
};

// ---------------------------------------------------------------------------
// Tag chip on thread item
// ---------------------------------------------------------------------------

const ThreadTagChip: FC<{
  tag: TagRow;
  threadRemoteId: string | undefined;
}> = ({ tag, threadRemoteId }) => {
  const [hovered, setHovered] = useState(false);

  const handleRemove = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!threadRemoteId) return;
    await removeTagFromThread(threadRemoteId, tag.id);
    // Update local store
    const store = useTagStore.getState();
    const newTags = (store.threadTags[threadRemoteId] ?? []).filter(
      (t) => t.id !== tag.id,
    );
    const newThreadTags = { ...store.threadTags, [threadRemoteId]: newTags };
    const newThreads = store.threads.map((th) =>
      th.remoteId === threadRemoteId ? { ...th, tags: newTags } : th,
    );
    useTagStore.getState().setThreadTags(newThreadTags, newThreads);
  };

  return (
    <span
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`inline-flex items-center gap-0.5 rounded px-1 py-0 text-[10px] font-medium leading-tight ${getTagColor(tag.id)}`}
    >
      {tag.name}
      {hovered && (
        <button
          onClick={handleRemove}
          className="ml-0.5 inline-flex size-3 items-center justify-center rounded-full opacity-60 hover:opacity-100"
        >
          <XIcon className="size-2" />
        </button>
      )}
    </span>
  );
};

// ---------------------------------------------------------------------------
// Thread item more options
// ---------------------------------------------------------------------------

const ThreadListItemMore: FC<{ threadRemoteId: string | undefined }> = ({
  threadRemoteId,
}) => {
  const tags = useTagStore((s) => s.tags);
  const threadTags = useTagStore((s) =>
    threadRemoteId ? (s.threadTags[threadRemoteId] ?? []) : [],
  );
  const assignedIds = new Set(threadTags.map((t) => t.id));
  const availableTags = tags.filter((t) => !assignedIds.has(t.id));

  const handleAddTag = async (tagId: number) => {
    if (!threadRemoteId) return;
    await addTagToThread(threadRemoteId, tagId);
    const store = useTagStore.getState();
    const tag = tags.find((t) => t.id === tagId);
    if (tag) {
      const newTags = [...(store.threadTags[threadRemoteId] ?? []), tag];
      const newThreadTags = { ...store.threadTags, [threadRemoteId]: newTags };
      const newThreads = store.threads.map((th) =>
        th.remoteId === threadRemoteId ? { ...th, tags: newTags } : th,
      );
      useTagStore.getState().setThreadTags(newThreadTags, newThreads);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="aui-thread-list-item-more mr-2 size-7 p-0 opacity-0 transition-opacity group-hover/thread:opacity-100 data-[state=open]:bg-accent data-[state=open]:opacity-100 group-data-active:opacity-100"
        >
          <MoreHorizontalIcon className="size-4" />
          <span className="sr-only">More options</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="start" className="min-w-36">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger
            disabled={availableTags.length === 0}
            className="data-disabled:pointer-events-none data-disabled:opacity-50"
          >
            <BookmarkIcon className="size-4" />
            Add Tag
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {availableTags.map((tag) => (
              <DropdownMenuItem
                key={tag.id}
                onClick={() => handleAddTag(tag.id)}
              >
                <span
                  className={`inline-flex rounded px-1.5 py-0 text-[10px] font-medium ${getTagColor(tag.id)}`}
                >
                  {tag.name}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <ThreadListItemPrimitive.Archive asChild>
          <DropdownMenuItem>
            <ArchiveIcon className="size-4" />
            Archive
          </DropdownMenuItem>
        </ThreadListItemPrimitive.Archive>
        <ThreadListItemPrimitive.Delete asChild>
          <DropdownMenuItem variant="destructive">
            <TrashIcon className="size-4" />
            Delete
          </DropdownMenuItem>
        </ThreadListItemPrimitive.Delete>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
