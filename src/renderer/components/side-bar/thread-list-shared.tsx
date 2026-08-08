import { useMemo, useRef, useState, type FC } from "react";
import {
  CheckIcon,
  CheckSquare,
  ChevronRightIcon,
  Plus,
  Square,
  XIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useTagStore, type ThreadInfo } from "@/stores/tagStore";
import { getRandomPaletteColor } from "@/lib/tagColors";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import type { TagRow } from "@shared/tag";
import { TagBadge } from "./tag-badge";

// Stable empty array for selectors that need a default. Shared so the chat and
// entertainment lists use the same reference.
export const EMPTY_TAGS: TagRow[] = [];

/** True when no search is active, or when `id` is in the current search results. */
export function matchesSearch(
  id: string,
  searchResultIds: Set<string> | null,
): boolean {
  if (!searchResultIds) return true;
  return searchResultIds.has(id);
}

/** Long-press hook for activating multi-select mode on a thread item. */
export function useLongPress(callback: () => void, delay = 500) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  return {
    onPointerDown: () => {
      timerRef.current = setTimeout(callback, delay);
    },
    onPointerUp: () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    onPointerLeave: () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    onPointerCancel: () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
  };
}

/** Shared multi-select handlers for a thread item (reads only tagStore). */
export function useMultiSelectHandlers(threadId: string | undefined) {
  const isMultiSelectMode = useTagStore((s) => s.isMultiSelectMode);
  const selectedThreadIds = useTagStore((s) => s.selectedThreadIds);
  const toggleThreadSelection = useTagStore((s) => s.toggleThreadSelection);
  const setMultiSelectMode = useTagStore((s) => s.setMultiSelectMode);

  const isSelected = threadId ? selectedThreadIds.has(threadId) : false;

  const longPress = useLongPress(() => {
    if (threadId) {
      setMultiSelectMode(true);
      toggleThreadSelection(threadId);
    }
  });

  const handleClick = () => {
    if (threadId) toggleThreadSelection(threadId);
  };

  const selectionIndicator =
    isMultiSelectMode ?
      <span className={cn("shrink-0", !threadId && "pl-1")}>
        {isSelected ?
          <CheckSquare className="size-4 text-primary" />
        : <Square className="size-4 text-muted-foreground" />}
      </span>
    : null;

  const activeStyles =
    isMultiSelectMode && isSelected ?
      "bg-accent border-l-2 border-primary"
    : "";

  return {
    isMultiSelectMode,
    isSelected,
    longPress,
    handleClick,
    selectionIndicator,
    activeStyles,
  };
}

export interface TagGroup {
  tagName: string;
  tagColor: string | null;
  threads: ThreadInfo[];
}

/**
 * Group threads by their primary tag, applying the archive/tag/search filters.
 * Pure (no hooks) so both the chat list and the entertainment list share it.
 * Returns the tag-ordered groups plus the untagged threads (the caller renders
 * the untagged group with its own localized label).
 */
export function buildTagGroups(args: {
  threads: ThreadInfo[];
  allTags: TagRow[];
  selectedTagId: number | null;
  viewingArchive: boolean;
  searchResultIds: Set<string> | null;
}): { tagGroups: TagGroup[]; untagged: ThreadInfo[] } {
  const { threads, allTags, selectedTagId, viewingArchive, searchResultIds } =
    args;
  const groupMap = new Map<number, TagGroup>();
  const untagged: ThreadInfo[] = [];

  for (const thread of threads) {
    if (viewingArchive && thread.status !== "archived") continue;
    if (!viewingArchive && thread.status !== "regular") continue;

    if (
      selectedTagId !== null &&
      !thread.tags.some((t) => t.id === selectedTagId)
    ) {
      continue;
    }

    if (!matchesSearch(thread.id, searchResultIds)) continue;

    if (thread.tags.length === 0) {
      untagged.push(thread);
    } else {
      const primaryTag = thread.tags[0]!;
      if (!groupMap.has(primaryTag.id)) {
        groupMap.set(primaryTag.id, {
          tagName: primaryTag.name,
          tagColor: primaryTag.color,
          threads: [],
        });
      }
      groupMap.get(primaryTag.id)!.threads.push(thread);
    }
  }

  const tagGroups = allTags
    .filter((t) => groupMap.has(t.id))
    .map((t) => groupMap.get(t.id)!)
    .filter(Boolean);

  return { tagGroups, untagged };
}

/** Tag chip rendered on a thread item; hover reveals a remove control. */
export const ThreadTagChip: FC<{
  tag: TagRow;
  threadId: string | undefined;
}> = ({ tag, threadId }) => {
  const [hovered, setHovered] = useState(false);

  const handleRemove = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!threadId) return;
    await useTagStore.getState().removeTagFromThread(threadId, tag.id);
  };

  return (
    <TagBadge
      color={tag.color}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="gap-0.5 px-1 py-0 text-[10px] leading-tight"
    >
      {tag.name}
      {hovered && (
        <span
          role="button"
          tabIndex={0}
          onClick={handleRemove}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ")
              handleRemove(e as unknown as React.MouseEvent);
          }}
          className="ml-0.5 inline-flex size-3 cursor-pointer items-center justify-center rounded-full opacity-60 hover:opacity-100"
        >
          <XIcon className="size-2" />
        </span>
      )}
    </TagBadge>
  );
};

/** A collapsible group of threads under one tag. Prop-driven (no aui). */
export const CollapsibleTagGroup: FC<{
  group: TagGroup;
  activeThreadId: string | null;
  onSwitch: (threadId: string) => void;
}> = ({ group, activeThreadId, onSwitch }) => {
  const [open, setOpen] = useState(true);
  const isMultiSelectMode = useTagStore((s) => s.isMultiSelectMode);
  const selectedThreadIds = useTagStore((s) => s.selectedThreadIds);
  const selectAllThreads = useTagStore((s) => s.selectAllThreads);

  const groupIds = group.threads.map((t) => t.id);
  const allGroupSelected =
    groupIds.length > 0 && groupIds.every((id) => selectedThreadIds.has(id));

  const handleGroupSelectAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (allGroupSelected) {
      const remaining = [...selectedThreadIds].filter(
        (id) => !groupIds.includes(id),
      );
      selectAllThreads(remaining);
    } else {
      const merged = new Set([...selectedThreadIds, ...groupIds]);
      selectAllThreads([...merged]);
    }
  };

  return (
    <div className="flex flex-col">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold text-muted-foreground hover:bg-muted"
      >
        <ChevronRightIcon
          className={`size-3 transition-transform ${open ? "rotate-90" : ""}`}
        />
        <TagBadge color={group.tagColor} className="px-1.5 py-0 text-[10px]">
          {group.tagName}
        </TagBadge>
        <span className="text-[10px] font-normal">
          ({group.threads.length})
        </span>
        {isMultiSelectMode && (
          <span
            role="button"
            tabIndex={0}
            onClick={handleGroupSelectAll}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ")
                handleGroupSelectAll(e as unknown as React.MouseEvent);
            }}
            className="ml-auto"
          >
            {allGroupSelected ?
              <CheckSquare className="size-3.5 text-primary" />
            : <Square className="size-3.5 text-muted-foreground" />}
          </span>
        )}
      </button>
      {open && (
        <div className="ml-2 flex flex-col gap-0.5 border-l pl-2">
          {group.threads.map((thread) => (
            <GroupedThreadItem
              key={thread.id}
              thread={thread}
              activeThreadId={activeThreadId}
              onSwitch={onSwitch}
            />
          ))}
        </div>
      )}
    </div>
  );
};

/** A single thread row inside a collapsible tag group. Prop-driven (no aui). */
export const GroupedThreadItem: FC<{
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

  return (
    <button
      onClick={() => {
        if (isMultiSelectMode) {
          handleClick();
        } else {
          onSwitch(thread.id);
        }
      }}
      className={cn(
        "flex min-h-9 items-center gap-2 rounded-lg px-3 py-1 text-start text-sm transition-colors hover:bg-muted",
        activeThreadId === thread.id && !isMultiSelectMode && "bg-muted",
        activeStyles,
      )}
      {...(!isMultiSelectMode ? longPress : {})}
    >
      {selectionIndicator}
      <span className="min-w-0 flex-1 truncate">{thread.title}</span>
      {thread.tags.map((tag) => (
        <TagBadge
          key={tag.id}
          color={tag.color}
          className="px-1 py-0 text-[10px]"
        >
          {tag.name}
        </TagBadge>
      ))}
    </button>
  );
};

// Hook wrapper around buildTagGroups for ergonomic use in components.
export function useTagGroups() {
  const threads = useTagStore((s) => s.threads);
  const allTags = useTagStore((s) => s.tags);
  const selectedTagId = useTagStore((s) => s.selectedTagId);
  const viewingArchive = useTagStore((s) => s.viewingArchive);
  const searchResultIds = useTagStore((s) => s.searchResultIds);
  return useMemo(
    () =>
      buildTagGroups({
        threads,
        allTags,
        selectedTagId,
        viewingArchive,
        searchResultIds,
      }),
    [threads, allTags, selectedTagId, viewingArchive, searchResultIds],
  );
}

/**
 * Filter a tag list by a search query and decide whether a new tag can be
 * created from that query. Shared by TagPanel (sidebar) and the add-tag
 * submenu so both filter and create identically.
 */
export function useTagFilter(
  tags: TagRow[],
  query: string,
): {
  filtered: TagRow[];
  canCreate: boolean;
} {
  return useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered =
      q ? tags.filter((t) => t.name.toLowerCase().includes(q)) : tags;
    const canCreate =
      q.length > 0 && !tags.some((t) => t.name.toLowerCase() === q);
    return { filtered, canCreate };
  }, [tags, query]);
}

/**
 * Shared add-tag submenu body: a search input, a scrollable list of tag badges
 * (assigned ones disabled + checked), and a create-and-attach item when the
 * query names no existing tag. `onSelect` is prevented so the submenu stays
 * open — the user can attach several tags in one visit.
 */
export const AddTagSubmenuContent: FC<{
  threadId: string;
  assignedTagIds: Set<number>;
}> = ({ threadId, assignedTagIds }) => {
  const { t } = useTranslation("common");
  const tags = useTagStore((s) => s.tags);
  const [query, setQuery] = useState("");
  const { filtered, canCreate } = useTagFilter(tags, query);

  const addTag = async (tagId: number) => {
    await useTagStore.getState().addTagToThread(threadId, tagId);
  };
  const createAndAdd = async () => {
    const created = await useTagStore
      .getState()
      .createTag(query.trim(), getRandomPaletteColor());
    await addTag(created.id);
    setQuery("");
  };

  return (
    <>
      <div className="border-b p-1">
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          placeholder={t("sidebar.searchTagsPlaceholder")}
          className="h-7 text-xs"
        />
      </div>
      <div className="max-h-[200px] overflow-y-auto p-1">
        {filtered.length === 0 && !canCreate && (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            {t("sidebar.tagPickerEmpty")}
          </div>
        )}
        {filtered.map((tag) => {
          const applied = assignedTagIds.has(tag.id);
          return (
            <DropdownMenuItem
              key={tag.id}
              disabled={applied}
              onSelect={(e) => {
                e.preventDefault();
                void addTag(tag.id);
              }}
            >
              <TagBadge color={tag.color}>{tag.name}</TagBadge>
              {applied && (
                <CheckIcon className="ml-auto size-3.5 text-muted-foreground" />
              )}
            </DropdownMenuItem>
          );
        })}
        {canCreate && (
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              void createAndAdd();
            }}
          >
            <Plus className="size-4" />
            {t("sidebar.createTagItem", { name: query.trim() })}
          </DropdownMenuItem>
        )}
      </div>
    </>
  );
};
