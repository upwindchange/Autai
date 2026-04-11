import { useEffect, useRef, useState } from "react";
import {
  ArchiveIcon,
  BookmarkIcon,
  ListIcon,
  FolderTreeIcon,
  PencilIcon,
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
import { deleteAllThreads, archiveAllThreads } from "@/lib/tagApi";
import { useTranslation } from "react-i18next";

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

  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const [deleteAllDialogOpen, setDeleteAllDialogOpen] = useState(false);

  useEffect(() => {
    fetchTags();
  }, [fetchTags]);

  const handleToggle = (panel: ActivePanel) => {
    setActivePanel((prev) => (prev === panel ? null : panel));
  };

  const handleDeleteAll = async () => {
    await deleteAllThreads(viewingArchive ? "archived" : "regular");
    setDeleteAllDialogOpen(false);
    window.location.reload();
  };

  const handleArchiveAll = async () => {
    await archiveAllThreads();
    setDeleteAllDialogOpen(false);
    window.location.reload();
  };

  return (
    <div className="flex flex-col px-2">
      {/* Toolbar row */}
      <div className="flex items-center gap-1">
        <ViewModeToggle mode={viewMode} onChange={setViewMode} />
        <ToolbarIconButton
          icon={ArchiveIcon}
          label={t("sidebar.archiveView")}
          active={viewingArchive}
          onClick={() => setViewingArchive(!viewingArchive)}
        />
        <ToolbarIconButton
          icon={BookmarkIcon}
          label={t("sidebar.tags")}
          active={activePanel === "tags"}
          onClick={() => handleToggle("tags")}
        />
        <ToolbarIconButton
          icon={Search}
          label={t("sidebar.search")}
          active={activePanel === "search"}
          onClick={() => handleToggle("search")}
        />
        <ToolbarIconButton
          icon={TrashIcon}
          label={t("sidebar.deleteAll")}
          active={false}
          onClick={() => setDeleteAllDialogOpen(true)}
        />
      </div>

      {/* Conditional panel */}
      {activePanel && (
        <div className="mt-1.5 overflow-hidden p-1">
          {activePanel === "tags" && <TagPanel />}
          {activePanel === "search" && (
            <SearchPanel onClose={() => setActivePanel(null)} />
          )}
        </div>
      )}

      {/* Delete all dialog */}
      <DeleteAllDialog
        open={deleteAllDialogOpen}
        onOpenChange={setDeleteAllDialogOpen}
        viewingArchive={viewingArchive}
        onDeleteAll={handleDeleteAll}
        onArchiveAll={handleArchiveAll}
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
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={active ? "secondary" : "ghost"}
          size="icon"
          className="size-6"
          onClick={onClick}
        >
          <Icon className="size-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
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
            variant={mode === "flat" ? "secondary" : "ghost"}
            size="icon"
            className="size-6 rounded-r-none"
            onClick={() => onChange("flat")}
          >
            <ListIcon className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t("sidebar.listView")}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={mode === "grouped" ? "secondary" : "ghost"}
            size="icon"
            className="size-6 rounded-l-none"
            onClick={() => onChange("grouped")}
          >
            <FolderTreeIcon className="size-3.5" />
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
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="flex items-center gap-1">
      <Input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("sidebar.searchPlaceholder")}
        className="h-6 text-xs"
      />
      <Button variant="ghost" size="icon" className="size-6" onClick={onClose}>
        <XIcon className="size-3" />
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Delete all confirmation dialog
// ---------------------------------------------------------------------------

function DeleteAllDialog({
  open,
  onOpenChange,
  viewingArchive,
  onDeleteAll,
  onArchiveAll,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  viewingArchive: boolean;
  onDeleteAll: () => void;
  onArchiveAll: () => void;
}) {
  const { t } = useTranslation("common");

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogMedia>
            <TrashIcon className="text-destructive" />
          </AlertDialogMedia>
          <AlertDialogTitle>{t("sidebar.deleteAll")}</AlertDialogTitle>
          <AlertDialogDescription>
            {viewingArchive ?
              t("sidebar.deleteAllArchivedDesc")
            : t("sidebar.deleteAllDesc")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          {!viewingArchive && (
            <AlertDialogAction onClick={onArchiveAll}>
              {t("sidebar.archiveAll")}
            </AlertDialogAction>
          )}
          <AlertDialogAction variant="destructive" onClick={onDeleteAll}>
            {t("sidebar.deleteAll")}
          </AlertDialogAction>
          <AlertDialogCancel>{t("btn.cancel")}</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
