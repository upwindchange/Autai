import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArchiveIcon,
  ArrowDownToLine,
  ArrowRightLeft,
  BookmarkIcon,
  CheckSquare,
  FolderTreeIcon,
  ListIcon,
  MoreHorizontalIcon,
  PencilIcon,
  RotateCcw,
  Search,
  TrashIcon,
  XIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogMedia,
} from "@/components/ui/alert-dialog";
import { useTagStore, type ViewMode } from "@/stores/tagStore";
import {
  deleteAllThreads,
  archiveAllThreads,
  bulkUpdateThreadStatus,
  bulkDeleteThreadsByIds,
} from "@/lib/tagApi";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Tag color utilities (re-exported for use by thread-list.tsx)
// ---------------------------------------------------------------------------

const TAG_COLORS = [
  "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  "bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200",
  "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200",
  "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
];

export function getTagColor(tagId: number): string {
  return TAG_COLORS[tagId % TAG_COLORS.length]!;
}

// ---------------------------------------------------------------------------
// Active panel type
// ---------------------------------------------------------------------------

type ActivePanel = "tags" | "search" | null;

// ---------------------------------------------------------------------------
// SidebarToolbar (exported)
// ---------------------------------------------------------------------------

export function SidebarToolbar() {
  const { t } = useTranslation("common");
  const viewMode = useTagStore((s) => s.viewMode);
  const setViewMode = useTagStore((s) => s.setViewMode);
  const viewingArchive = useTagStore((s) => s.viewingArchive);
  const setViewingArchive = useTagStore((s) => s.setViewingArchive);
  const fetchTags = useTagStore((s) => s.fetchTags);
  const threads = useTagStore((s) => s.threads);
  const selectedTagId = useTagStore((s) => s.selectedTagId);
  const isMultiSelectMode = useTagStore((s) => s.isMultiSelectMode);
  const setMultiSelectMode = useTagStore((s) => s.setMultiSelectMode);
  const clearSearch = useTagStore((s) => s.clearSearch);

  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const [activeDialog, setActiveDialog] = useState<
    "delete" | "archive" | "restore" | null
  >(null);

  useEffect(() => {
    fetchTags();
  }, [fetchTags]);

  const allVisibleThreadIds = useMemo(
    () =>
      threads
        .filter((t) => {
          if (viewingArchive && t.status !== "archived") return false;
          if (!viewingArchive && t.status !== "regular") return false;
          if (
            selectedTagId !== null &&
            !t.tags.some((tag) => tag.id === selectedTagId)
          )
            return false;
          return true;
        })
        .map((t) => t.remoteId),
    [threads, viewingArchive, selectedTagId],
  );

  const handleToggle = (panel: ActivePanel) => {
    setActivePanel((prev) => {
      if (prev === panel) {
        if (panel === "search") clearSearch();
        return null;
      }
      return panel;
    });
  };

  const handleBulkActionAll = async (
    action: "delete" | "archive" | "restore",
  ) => {
    switch (action) {
      case "delete":
        await deleteAllThreads(viewingArchive ? "archived" : "regular");
        break;
      case "archive":
        await archiveAllThreads();
        break;
      case "restore":
        await bulkUpdateThreadStatus(allVisibleThreadIds, "regular");
        break;
    }
    setActiveDialog(null);
    window.location.reload();
  };

  return (
    <div className="flex flex-col px-2">
      {/* Single toolbar row */}
      <div className="flex items-center gap-1">
        {/* View controls: List | Grouped | Archive */}
        <ViewModeToggle mode={viewMode} onChange={setViewMode} />
        <ToolbarIconButton
          icon={ArchiveIcon}
          label={t("sidebar.archiveView")}
          active={viewingArchive}
          onClick={() => setViewingArchive(!viewingArchive)}
        />

        <div className="mx-0.5 h-4 w-px bg-border" />

        {/* Core navigation tools */}
        <ToolbarIconButton
          icon={BookmarkIcon}
          label={t("sidebar.tags")}
          active={activePanel === "tags"}
          onClick={() => handleToggle("tags")}
          disabled={viewingArchive}
        />
        <ToolbarIconButton
          icon={Search}
          label={t("sidebar.search")}
          active={activePanel === "search"}
          onClick={() => handleToggle("search")}
        />
        <ToolbarIconButton
          icon={CheckSquare}
          label={t("sidebar.multiSelect")}
          active={isMultiSelectMode}
          onClick={() => setMultiSelectMode(!isMultiSelectMode)}
        />

        {/* Spacer pushes "more" to the right */}
        <div className="flex-1" />

        {/* Overflow menu: archive all, delete all, restore all */}
        <MoreMenu
          viewingArchive={viewingArchive}
          onArchiveAll={() => setActiveDialog("archive")}
          onDeleteAll={() => setActiveDialog("delete")}
          onRestoreAll={() => setActiveDialog("restore")}
        />
      </div>

      {/* Multi-select panel */}
      {isMultiSelectMode && (
        <MultiSelectPanel
          allVisibleThreadIds={allVisibleThreadIds}
          viewingArchive={viewingArchive}
        />
      )}

      {/* Conditional panel */}
      {activePanel && (
        <div className="mt-1.5 overflow-hidden p-1">
          {activePanel === "tags" && <TagPanel />}
          {activePanel === "search" && (
            <SearchPanel onClose={() => setActivePanel(null)} />
          )}
        </div>
      )}

      {/* Confirmation dialog for bulk actions */}
      <BulkActionDialog
        open={activeDialog !== null}
        onOpenChange={(open) => !open && setActiveDialog(null)}
        action={activeDialog}
        viewingArchive={viewingArchive}
        onConfirm={() => handleBulkActionAll(activeDialog!)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toolbar icon button
// ---------------------------------------------------------------------------

function ToolbarIconButton({
  icon: Icon,
  label,
  active,
  onClick,
  disabled,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("size-6", active && "bg-muted hover:bg-muted")}
          onClick={onClick}
          disabled={disabled}
        >
          <Icon className={cn("size-3.5", active && "text-blue-500")} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// More menu (overflow dropdown for archive, restore, delete)
// ---------------------------------------------------------------------------

function MoreMenu({
  viewingArchive,
  onArchiveAll,
  onDeleteAll,
  onRestoreAll,
}: {
  viewingArchive: boolean;
  onArchiveAll: () => void;
  onDeleteAll: () => void;
  onRestoreAll: () => void;
}) {
  const { t } = useTranslation("common");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-6">
          <MoreHorizontalIcon className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="end" className="min-w-40">
        {!viewingArchive && (
          <DropdownMenuItem onClick={onArchiveAll}>
            <ArchiveIcon className="size-4" />
            {t("sidebar.archiveAll")}
          </DropdownMenuItem>
        )}
        {viewingArchive && (
          <DropdownMenuItem onClick={onRestoreAll}>
            <RotateCcw className="size-4" />
            {t("sidebar.restoreAll")}
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem variant="destructive" onClick={onDeleteAll}>
          <TrashIcon className="size-4" />
          {t("sidebar.deleteAll")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---------------------------------------------------------------------------
// View mode toggle (List / Folder)
// ---------------------------------------------------------------------------

function ViewModeToggle({
  mode,
  onChange,
}: {
  mode: ViewMode;
  onChange: (m: ViewMode) => void;
}) {
  const { t } = useTranslation("common");

  return (
    <div className="flex rounded-md border">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "size-6 rounded-r-none",
              mode === "flat" && "bg-muted hover:bg-muted",
            )}
            onClick={() => onChange("flat")}
          >
            <ListIcon
              className={cn("size-3.5", mode === "flat" && "text-blue-500")}
            />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t("sidebar.listView")}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "size-6 rounded-l-none",
              mode === "grouped" && "bg-muted hover:bg-muted",
            )}
            onClick={() => onChange("grouped")}
          >
            <FolderTreeIcon
              className={cn("size-3.5", mode === "grouped" && "text-blue-500")}
            />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {t("sidebar.groupedView")}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tag panel: create input + tag chips
// ---------------------------------------------------------------------------

function TagPanel() {
  const tags = useTagStore((s) => s.tags);
  const selectedTagId = useTagStore((s) => s.selectedTagId);
  const setSelectedTagId = useTagStore((s) => s.setSelectedTagId);
  const { t } = useTranslation("common");

  return (
    <div className="flex flex-col gap-1.5">
      {/* Create tag input */}
      <CreateTagInput />

      {/* Tag chips */}
      <div className="flex flex-wrap gap-1">
        <TagChip
          label={t("sidebar.tagAll")}
          color="bg-muted text-muted-foreground"
          selected={selectedTagId === null}
          onClick={() => setSelectedTagId(null)}
        />
        {tags.map((tag) => (
          <ContextMenu key={tag.id}>
            <ContextMenuTrigger asChild>
              <div>
                <TagChip
                  label={tag.name}
                  color={getTagColor(tag.id)}
                  selected={selectedTagId === tag.id}
                  onClick={() =>
                    setSelectedTagId(selectedTagId === tag.id ? null : tag.id)
                  }
                />
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <RenameTagMenuItem tagId={tag.id} currentName={tag.name} />
              <ContextMenuItem
                className="text-destructive"
                onClick={() => useTagStore.getState().deleteTag(tag.id)}
              >
                <TrashIcon className="mr-2 size-4" />
                {t("sidebar.tagDelete")}
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        ))}
      </div>
    </div>
  );
}

function TagChip({
  label,
  color,
  selected,
  onClick,
}: {
  label: string;
  color: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium transition-opacity ${color} ${selected ? "ring-2 ring-primary opacity-100" : "opacity-70 hover:opacity-100"}`}
    >
      {label}
    </button>
  );
}

function CreateTagInput() {
  const { t } = useTranslation("common");
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    await useTagStore.getState().createTag(trimmed);
    setName("");
  };

  return (
    <Input
      ref={inputRef}
      value={name}
      onChange={(e) => setName(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") handleSubmit();
      }}
      placeholder={t("sidebar.createTagPlaceholder")}
      className="h-6 text-xs"
    />
  );
}

function RenameTagMenuItem({
  tagId,
  currentName,
}: {
  tagId: number;
  currentName: string;
}) {
  const { t } = useTranslation("common");
  const [isRenaming, setIsRenaming] = useState(false);
  const [name, setName] = useState(currentName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isRenaming) inputRef.current?.focus();
  }, [isRenaming]);

  if (isRenaming) {
    return (
      <div className="flex items-center gap-1 px-2 py-1.5">
        <Input
          ref={inputRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={async (e) => {
            if (e.key === "Enter") {
              const trimmed = name.trim();
              if (trimmed && trimmed !== currentName) {
                await useTagStore.getState().renameTag(tagId, trimmed);
              }
              setIsRenaming(false);
            }
            if (e.key === "Escape") {
              setName(currentName);
              setIsRenaming(false);
            }
          }}
          className="h-6 text-xs"
        />
      </div>
    );
  }

  return (
    <ContextMenuItem onClick={() => setIsRenaming(true)}>
      <PencilIcon className="mr-2 size-4" />
      {t("sidebar.tagRename")}
    </ContextMenuItem>
  );
}

// ---------------------------------------------------------------------------
// Search panel (UI only, no backend)
// ---------------------------------------------------------------------------

function SearchPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation("common");
  const searchQuery = useTagStore((s) => s.searchQuery);
  const setSearchQuery = useTagStore((s) => s.setSearchQuery);
  const performSearch = useTagStore((s) => s.performSearch);
  const clearSearch = useTagStore((s) => s.clearSearch);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounced server-side search
  useEffect(() => {
    const timer = setTimeout(() => {
      performSearch(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, performSearch]);

  const handleClose = () => {
    clearSearch();
    onClose();
  };

  return (
    <div className="flex items-center gap-1">
      <Input
        ref={inputRef}
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder={t("sidebar.searchPlaceholder")}
        className="h-6 text-xs"
      />
      <Button variant="ghost" size="icon" className="size-6" onClick={handleClose}>
        <XIcon className="size-3" />
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Multi-select panel
// ---------------------------------------------------------------------------

function MultiSelectPanel({
  allVisibleThreadIds,
  viewingArchive,
}: {
  allVisibleThreadIds: string[];
  viewingArchive: boolean;
}) {
  const { t } = useTranslation("common");
  const selectedThreadIds = useTagStore((s) => s.selectedThreadIds);
  const selectAllThreads = useTagStore((s) => s.selectAllThreads);
  const invertSelection = useTagStore((s) => s.invertSelection);
  const selectThreadsDownward = useTagStore((s) => s.selectThreadsDownward);
  const exitMultiSelectMode = useTagStore((s) => s.exitMultiSelectMode);

  const handleBulkAction = async (action: "archive" | "delete" | "restore") => {
    const ids = [...selectedThreadIds];
    switch (action) {
      case "archive":
        await bulkUpdateThreadStatus(ids, "archived");
        break;
      case "delete":
        await bulkDeleteThreadsByIds(ids);
        break;
      case "restore":
        await bulkUpdateThreadStatus(ids, "regular");
        break;
    }
    exitMultiSelectMode();
    window.location.reload();
  };

  const handleSelectAllDownward = () => {
    if (selectedThreadIds.size === 0) {
      selectThreadsDownward(allVisibleThreadIds, 0);
      return;
    }
    const indices = [...selectedThreadIds]
      .map((id) => allVisibleThreadIds.indexOf(id))
      .filter((i) => i >= 0);
    const minIndex = Math.min(...indices);
    selectThreadsDownward(allVisibleThreadIds, minIndex);
  };

  return (
    <div className="flex items-center gap-1 py-1">
      <ToolbarIconButton
        icon={CheckSquare}
        label={t("sidebar.selectAll")}
        active={false}
        onClick={() => selectAllThreads(allVisibleThreadIds)}
      />
      <ToolbarIconButton
        icon={ArrowDownToLine}
        label={t("sidebar.selectAllDownward")}
        active={false}
        onClick={handleSelectAllDownward}
      />
      <ToolbarIconButton
        icon={ArrowRightLeft}
        label={t("sidebar.invertSelection")}
        active={false}
        onClick={() => invertSelection(allVisibleThreadIds)}
      />
      <div className="mx-0.5 h-4 w-px bg-border" />
      {!viewingArchive && (
        <ToolbarIconButton
          icon={ArchiveIcon}
          label={t("sidebar.archiveSelected")}
          active={false}
          onClick={() => handleBulkAction("archive")}
          disabled={selectedThreadIds.size === 0}
        />
      )}
      {viewingArchive && (
        <ToolbarIconButton
          icon={RotateCcw}
          label={t("sidebar.restoreSelected")}
          active={false}
          onClick={() => handleBulkAction("restore")}
          disabled={selectedThreadIds.size === 0}
        />
      )}
      <ToolbarIconButton
        icon={TrashIcon}
        label={t("sidebar.deleteSelected")}
        active={false}
        onClick={() => handleBulkAction("delete")}
        disabled={selectedThreadIds.size === 0}
      />
      <span className="ml-auto text-xs text-muted-foreground">
        {t("sidebar.selectedCount", { count: selectedThreadIds.size })}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bulk action confirmation dialog (archive all / restore all / delete all)
// ---------------------------------------------------------------------------

const BULK_ACTION_CONFIGS: Record<
  "delete" | "archive" | "restore",
  {
    icon: React.ComponentType<{ className?: string }>;
    iconClassName: string;
    titleKey: string;
    descKey: string;
    actionVariant?: "destructive" | "default";
  }
> = {
  delete: {
    icon: TrashIcon,
    iconClassName: "text-destructive",
    titleKey: "sidebar.deleteAll",
    descKey: "sidebar.deleteAllDesc",
    actionVariant: "destructive",
  },
  archive: {
    icon: ArchiveIcon,
    iconClassName: "text-primary",
    titleKey: "sidebar.archiveAll",
    descKey: "sidebar.archiveAllDesc",
  },
  restore: {
    icon: RotateCcw,
    iconClassName: "text-primary",
    titleKey: "sidebar.restoreAll",
    descKey: "sidebar.restoreAllDesc",
  },
};

function BulkActionDialog({
  open,
  onOpenChange,
  action,
  viewingArchive,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: "delete" | "archive" | "restore" | null;
  viewingArchive?: boolean;
  onConfirm: () => void;
}) {
  const { t } = useTranslation("common");
  if (!action) return null;

  const config = BULK_ACTION_CONFIGS[action];
  const Icon = config.icon;

  const description =
    action === "delete" && viewingArchive ?
      t("sidebar.deleteAllArchivedDesc")
    : t(config.descKey);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogMedia>
            <Icon className={config.iconClassName} />
          </AlertDialogMedia>
          <AlertDialogTitle>{t(config.titleKey)}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction variant={config.actionVariant} onClick={onConfirm}>
            {t(config.titleKey)}
          </AlertDialogAction>
          <AlertDialogCancel>{t("btn.cancel")}</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
