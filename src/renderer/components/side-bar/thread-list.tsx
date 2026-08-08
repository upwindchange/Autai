import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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
import { useTranslation } from "react-i18next";
import {
  ArchiveIcon,
  BookmarkIcon,
  MoreHorizontalIcon,
  PencilIcon,
  TrashIcon,
} from "lucide-react";
import { useState, type FC } from "react";
import { useTagStore } from "@/stores/tagStore";
import { cn } from "@/lib/utils";
import {
  EMPTY_TAGS,
  ThreadTagChip,
  useMultiSelectHandlers,
  matchesSearch,
  CollapsibleTagGroup,
  useTagGroups,
  AddTagSubmenuContent,
} from "./thread-list-shared";

export const ThreadList: FC = () => {
  const viewMode = useTagStore((s) => s.viewMode);

  return (
    <ThreadListPrimitive.Root className="aui-root aui-thread-list-root flex flex-col gap-1">
      <AuiIf condition={(s) => s.threads.isLoading}>
        <ThreadListSkeleton />
      </AuiIf>
      <AuiIf condition={(s) => !s.threads.isLoading}>
        {viewMode === "grouped" ?
          <GroupedThreadList />
        : <FlatThreadList />}
      </AuiIf>
    </ThreadListPrimitive.Root>
  );
};

// ---------------------------------------------------------------------------
// Flat thread list (with tag filter)
// ---------------------------------------------------------------------------

const FlatThreadList: FC = () => {
  const viewingArchive = useTagStore((s) => s.viewingArchive);
  return (
    <ThreadListPrimitive.Items archived={viewingArchive}>
      {() => <ThreadListItem />}
    </ThreadListPrimitive.Items>
  );
};

// ---------------------------------------------------------------------------
// Grouped thread list (threads organized by tag in collapsible sections).
// Shared presentational pieces (CollapsibleTagGroup + grouping) come from
// thread-list-shared; this shell only supplies the aui-sourced active-thread
// id and switch handler as props.
// ---------------------------------------------------------------------------

const GroupedThreadList: FC = () => {
  const aui = useAui();
  const { t } = useTranslation("common");
  const mainThreadId = useAuiState((s) => s.threads.mainThreadId);
  const { tagGroups, untagged } = useTagGroups();
  const handleSwitch = (threadId: string) =>
    aui.threads.switchToThread(threadId);

  return (
    <div className="flex flex-col gap-1">
      {tagGroups.map((group) => (
        <CollapsibleTagGroup
          key={group.tagName}
          group={group}
          activeThreadId={mainThreadId ?? null}
          onSwitch={handleSwitch}
        />
      ))}
      {untagged.length > 0 && (
        <CollapsibleTagGroup
          group={{
            tagName: t("sidebar.untagged"),
            tagColor: null,
            threads: untagged,
          }}
          activeThreadId={mainThreadId ?? null}
          onSwitch={handleSwitch}
        />
      )}
    </div>
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
// Thread list item with inline tag chips. Iterated by assistant-ui's
// ThreadListPrimitive.Items, which sets the per-item context read below.
// ---------------------------------------------------------------------------

const ThreadListItem: FC = () => {
  // aui seam: the runtime exposes the item's id as `remoteId`; alias it to our
  // canonical `id` name immediately.
  const id = useAuiState((s) => s.threadListItem.remoteId);
  const threadTitle = useTagStore((s) =>
    id ?
      (s.threads.find((th) => th.id === id)?.title ?? "New Chat")
    : "New Chat",
  );
  const threadTags = useTagStore((s) =>
    id ? (s.threadTags[id] ?? EMPTY_TAGS) : EMPTY_TAGS,
  );
  const selectedTagId = useTagStore((s) => s.selectedTagId);
  const searchResultIds = useTagStore((s) => s.searchResultIds);
  const {
    isMultiSelectMode,
    longPress,
    handleClick,
    selectionIndicator,
    activeStyles,
  } = useMultiSelectHandlers(id);

  // Filter by selected tag
  if (
    selectedTagId !== null &&
    !threadTags.some((t) => t.id === selectedTagId)
  ) {
    return null;
  }

  // Filter by search results
  if (id && !matchesSearch(id, searchResultIds)) {
    return null;
  }

  return (
    <ThreadListItemPrimitive.Root
      className={cn(
        "aui-thread-list-item group/thread relative flex min-h-9 items-center gap-2 rounded-lg border border-transparent px-2 py-0.5 transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none data-active:border-l-2 data-active:border-primary data-active:bg-accent",
        activeStyles,
      )}
      onClickCapture={(e) => {
        if (isMultiSelectMode && id) {
          e.stopPropagation();
          handleClick();
        }
      }}
      {...(!isMultiSelectMode ? longPress : {})}
    >
      {selectionIndicator}
      <ThreadListItemPrimitive.Trigger className="aui-thread-list-item-trigger relative flex min-w-0 flex-1 flex-col items-start px-1 py-1 text-start text-sm">
        <div className="flex w-full items-center">
          <span className="aui-thread-list-item-title min-w-0 flex-1 truncate">
            {threadTitle}
          </span>
          <span className="pointer-events-none absolute right-0 top-0 h-6 w-8 shrink-0 bg-linear-to-l from-(--sidebar-background) to-transparent" />
        </div>
        <div className="flex flex-wrap items-center gap-0.5">
          {threadTags.map((tag) => (
            <ThreadTagChip key={tag.id} tag={tag} threadId={id} />
          ))}
        </div>
      </ThreadListItemPrimitive.Trigger>
      <ThreadListItemMore threadId={id} />
    </ThreadListItemPrimitive.Root>
  );
};

// ---------------------------------------------------------------------------
// Thread item more options (rename / add tag / archive / delete). The actions
// are aui components (ThreadListItemPrimitive.Archive/Delete), so this stays in
// the chat list rather than the aui-free shared module.
// ---------------------------------------------------------------------------

const ThreadListItemMore: FC<{ threadId: string | undefined }> = ({
  threadId,
}) => {
  const { t } = useTranslation("common");
  const viewingArchive = useTagStore((s) => s.viewingArchive);
  const threadTags = useTagStore((s) =>
    threadId ? (s.threadTags[threadId] ?? EMPTY_TAGS) : EMPTY_TAGS,
  );
  const assignedIds = new Set(threadTags.map((t) => t.id));

  // Get current thread title from store
  const currentTitle = useTagStore((s) =>
    threadId ?
      (s.threads.find((th) => th.id === threadId)?.title ?? "New Chat")
    : "New Chat",
  );

  // Rename dialog state
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(currentTitle);
  const handleRename = async () => {
    const trimmed = renameValue.trim();
    if (!threadId || !trimmed) return;
    await useTagStore.getState().renameThread(threadId, trimmed);
    setRenameOpen(false);
  };

  return (
    <>
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
          <DropdownMenuItem
            onClick={() => {
              setRenameValue(currentTitle);
              setRenameOpen(true);
            }}
          >
            <PencilIcon className="size-4" />
            {t("sidebar.rename")}
          </DropdownMenuItem>
          {threadId && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <BookmarkIcon className="size-4" />
                {t("sidebar.addTag")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-[260px] w-56 overflow-hidden p-0">
                <AddTagSubmenuContent
                  threadId={threadId}
                  assignedTagIds={assignedIds}
                />
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          {viewingArchive ?
            <ThreadListItemPrimitive.Unarchive asChild>
              <DropdownMenuItem>
                <ArchiveIcon className="size-4" />
                {t("sidebar.unarchive")}
              </DropdownMenuItem>
            </ThreadListItemPrimitive.Unarchive>
          : <ThreadListItemPrimitive.Archive asChild>
              <DropdownMenuItem>
                <ArchiveIcon className="size-4" />
                {t("sidebar.archive")}
              </DropdownMenuItem>
            </ThreadListItemPrimitive.Archive>
          }
          <ThreadListItemPrimitive.Delete asChild>
            <DropdownMenuItem variant="destructive">
              <TrashIcon className="size-4" />
              {t("sidebar.delete")}
            </DropdownMenuItem>
          </ThreadListItemPrimitive.Delete>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("sidebar.renameTitle")}</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRename();
            }}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={handleRename}>{t("common.confirm")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
