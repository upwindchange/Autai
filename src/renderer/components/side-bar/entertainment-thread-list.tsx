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
import { useTranslation } from "react-i18next";
import {
  ArchiveIcon,
  BookmarkIcon,
  MoreHorizontalIcon,
  PencilIcon,
  TrashIcon,
} from "lucide-react";
import { useState, type FC } from "react";
import { useTagStore, type ThreadInfo } from "@/stores/tagStore";
import { useEntertainmentThreadsStore } from "@/stores/entertainmentThreadsStore";
import { cn } from "@/lib/utils";
import { archiveThread, unarchiveThread, deleteThread } from "@/lib/tagApi";
import {
  EMPTY_TAGS,
  ThreadTagChip,
  useMultiSelectHandlers,
  matchesSearch,
  CollapsibleTagGroup,
  useTagGroups,
  AddTagSubmenuContent,
} from "./thread-list-shared";

/**
 * Entertainment-mode thread list. It reads thread *data* and view-state (search,
 * multi-select, archive toggle, tag filter, flat/grouped) from the shared
 * {@link useTagStore} (so the shared SidebarToolbar stays in sync), and the
 * active-thread selection from the entertainment store. Item actions
 * (rename/tag/archive/delete) hit the REST backend directly.
 */
export const EntertainmentThreadList: FC = () => {
  const viewMode = useTagStore((s) => s.viewMode);
  const loading = useEntertainmentThreadsStore((s) => s.loading);

  if (loading) return <ThreadListSkeleton />;
  return viewMode === "grouped" ?
      <GroupedEntertainmentList />
    : <FlatEntertainmentList />;
};

// ---------------------------------------------------------------------------
// Grouped view — reuses the shared, prop-driven CollapsibleTagGroup.
// ---------------------------------------------------------------------------

const GroupedEntertainmentList: FC = () => {
  const { t } = useTranslation("common");
  const activeThreadId = useEntertainmentThreadsStore((s) => s.activeThreadId);
  const setActiveThreadId = useEntertainmentThreadsStore(
    (s) => s.setActiveThreadId,
  );
  const { tagGroups, untagged } = useTagGroups();

  return (
    <div className="flex flex-col gap-1">
      {tagGroups.map((group) => (
        <CollapsibleTagGroup
          key={group.tagName}
          group={group}
          activeThreadId={activeThreadId}
          onSwitch={setActiveThreadId}
        />
      ))}
      {untagged.length > 0 && (
        <CollapsibleTagGroup
          group={{
            tagName: t("sidebar.untagged"),
            tagColor: null,
            threads: untagged,
          }}
          activeThreadId={activeThreadId}
          onSwitch={setActiveThreadId}
        />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Flat view — filter tagStore.threads and render one item each.
// ---------------------------------------------------------------------------

const FlatEntertainmentList: FC = () => {
  const threads = useTagStore((s) => s.threads);
  const viewingArchive = useTagStore((s) => s.viewingArchive);
  const selectedTagId = useTagStore((s) => s.selectedTagId);
  const searchResultIds = useTagStore((s) => s.searchResultIds);
  const activeThreadId = useEntertainmentThreadsStore((s) => s.activeThreadId);
  const setActiveThreadId = useEntertainmentThreadsStore(
    (s) => s.setActiveThreadId,
  );

  const filtered = threads.filter((thread) => {
    if (viewingArchive && thread.status !== "archived") return false;
    if (!viewingArchive && thread.status !== "regular") return false;
    if (
      selectedTagId !== null &&
      !thread.tags.some((t) => t.id === selectedTagId)
    ) {
      return false;
    }
    if (!matchesSearch(thread.id, searchResultIds)) return false;
    return true;
  });

  if (filtered.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      {filtered.map((thread) => (
        <FlatEntertainmentItem
          key={thread.id}
          thread={thread}
          activeThreadId={activeThreadId}
          onSwitch={setActiveThreadId}
        />
      ))}
    </div>
  );
};

const FlatEntertainmentItem: FC<{
  thread: ThreadInfo;
  activeThreadId: string | null;
  onSwitch: (threadId: string) => void;
}> = ({ thread, activeThreadId, onSwitch }) => {
  const {
    isMultiSelectMode,
    longPress,
    handleClick,
    selectionIndicator,
    activeStyles,
  } = useMultiSelectHandlers(thread.id);
  const threadTags = useTagStore((s) =>
    s.threadTags[thread.id] ? s.threadTags[thread.id] : EMPTY_TAGS,
  );

  return (
    <div
      className={cn(
        "group/thread relative flex min-h-9 items-center gap-2 rounded-lg border border-transparent px-2 py-0.5 transition-colors hover:bg-muted",
        thread.id === activeThreadId &&
          !isMultiSelectMode &&
          "border-l-2 border-primary bg-accent",
        activeStyles,
      )}
      onClickCapture={(e) => {
        if (isMultiSelectMode) {
          e.stopPropagation();
          handleClick();
        }
      }}
      {...(!isMultiSelectMode ? longPress : {})}
    >
      {selectionIndicator}
      <button
        type="button"
        onClick={() =>
          isMultiSelectMode ? handleClick() : onSwitch(thread.id)
        }
        className="relative flex min-w-0 flex-1 flex-col items-start px-1 py-1 text-start text-sm"
      >
        <div className="flex w-full items-center">
          <span className="min-w-0 flex-1 truncate">{thread.title}</span>
          <span className="pointer-events-none absolute right-0 top-0 h-6 w-8 shrink-0 bg-linear-to-l from-(--sidebar-background) to-transparent" />
        </div>
        <div className="flex flex-wrap items-center gap-0.5">
          {threadTags.map((tag) => (
            <ThreadTagChip key={tag.id} tag={tag} threadId={thread.id} />
          ))}
        </div>
      </button>
      <EntertainmentThreadItemMenu threadId={thread.id} title={thread.title} />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Item actions (REST): rename / add tag / archive / delete.
// ---------------------------------------------------------------------------

const EntertainmentThreadItemMenu: FC<{
  threadId: string;
  title: string;
}> = ({ threadId, title }) => {
  const { t } = useTranslation("common");
  const viewingArchive = useTagStore((s) => s.viewingArchive);
  const threadTags = useTagStore((s) =>
    s.threadTags[threadId] ? s.threadTags[threadId] : EMPTY_TAGS,
  );
  const refresh = useEntertainmentThreadsStore((s) => s.refresh);
  const assignedIds = new Set(threadTags.map((t) => t.id));

  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(title);

  const handleRename = async () => {
    const trimmed = renameValue.trim();
    if (!trimmed) return;
    await useTagStore.getState().renameThread(threadId, trimmed);
    setRenameOpen(false);
  };

  const handleArchiveToggle = async () => {
    if (viewingArchive) {
      await unarchiveThread(threadId);
    } else {
      await archiveThread(threadId);
    }
    await refresh();
  };

  const handleDelete = async () => {
    await deleteThread(threadId);
    await refresh();
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="mr-2 size-7 p-0 opacity-0 transition-opacity group-hover/thread:opacity-100 data-[state=open]:bg-accent data-[state=open]:opacity-100"
          >
            <MoreHorizontalIcon className="size-4" />
            <span className="sr-only">More options</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom" align="start" className="min-w-36">
          <DropdownMenuItem
            onClick={() => {
              setRenameValue(title);
              setRenameOpen(true);
            }}
          >
            <PencilIcon className="size-4" />
            {t("sidebar.rename")}
          </DropdownMenuItem>
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
          <DropdownMenuItem onClick={() => void handleArchiveToggle()}>
            <ArchiveIcon className="size-4" />
            {viewingArchive ? t("sidebar.unarchive") : t("sidebar.archive")}
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onClick={() => void handleDelete()}
          >
            <TrashIcon className="size-4" />
            {t("sidebar.delete")}
          </DropdownMenuItem>
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
              if (e.key === "Enter") void handleRename();
            }}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => void handleRename()}>
              {t("common.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

const ThreadListSkeleton: FC = () => {
  return (
    <div className="flex flex-col gap-1">
      {Array.from({ length: 5 }, (_, i) => (
        <div
          key={i}
          role="status"
          aria-label="Loading threads"
          className="flex h-9 items-center px-3"
        >
          <Skeleton className="h-4 w-full" />
        </div>
      ))}
    </div>
  );
};
