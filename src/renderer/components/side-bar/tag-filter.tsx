import { useEffect, useRef, useState } from "react";
import {
  BookmarkIcon,
  ListIcon,
  FolderTreeIcon,
  XIcon,
  PencilIcon,
  TrashIcon,
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
  useTagStore,
  type ViewMode,
} from "@/stores/tagStore";

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

export function TagFilterBar() {
  const tags = useTagStore((s) => s.tags);
  const selectedTagId = useTagStore((s) => s.selectedTagId);
  const viewMode = useTagStore((s) => s.viewMode);
  const fetchTags = useTagStore((s) => s.fetchTags);
  const setSelectedTagId = useTagStore((s) => s.setSelectedTagId);
  const setViewMode = useTagStore((s) => s.setViewMode);

  const [showNewTag, setShowNewTag] = useState(false);

  useEffect(() => {
    fetchTags();
  }, [fetchTags]);

  return (
    <div className="flex flex-col gap-1.5 px-2">
      {/* Top row: view toggle + new tag button */}
      <div className="flex items-center justify-between">
        <ViewModeToggle mode={viewMode} onChange={setViewMode} />
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          onClick={() => setShowNewTag(true)}
        >
          <BookmarkIcon className="size-3.5" />
        </Button>
      </div>

      {/* New tag input */}
      {showNewTag && (
        <NewTagInput
          onCreated={() => setShowNewTag(false)}
          onCancelled={() => setShowNewTag(false)}
        />
      )}

      {/* Tag chips */}
      <div className="flex flex-wrap gap-1">
        <TagChip
          label="All"
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
                    setSelectedTagId(
                      selectedTagId === tag.id ? null : tag.id,
                    )
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
                Delete
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        ))}
      </div>
    </div>
  );
}

function ViewModeToggle({
  mode,
  onChange,
}: {
  mode: ViewMode;
  onChange: (m: ViewMode) => void;
}) {
  return (
    <div className="flex rounded-md border">
      <Button
        variant={mode === "flat" ? "secondary" : "ghost"}
        size="icon"
        className="size-6 rounded-r-none"
        onClick={() => onChange("flat")}
        title="List view"
      >
        <ListIcon className="size-3.5" />
      </Button>
      <Button
        variant={mode === "grouped" ? "secondary" : "ghost"}
        size="icon"
        className="size-6 rounded-l-none"
        onClick={() => onChange("grouped")}
        title="Grouped view"
      >
        <FolderTreeIcon className="size-3.5" />
      </Button>
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

function NewTagInput({
  onCreated,
  onCancelled,
}: {
  onCreated: () => void;
  onCancelled: () => void;
}) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      onCancelled();
      return;
    }
    await useTagStore.getState().createTag(trimmed);
    onCreated();
  };

  return (
    <div className="flex items-center gap-1">
      <Input
        ref={inputRef}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSubmit();
          if (e.key === "Escape") onCancelled();
        }}
        placeholder="Tag name"
        className="h-6 text-xs"
      />
      <Button
        variant="ghost"
        size="icon"
        className="size-6"
        onClick={onCancelled}
      >
        <XIcon className="size-3" />
      </Button>
    </div>
  );
}

function RenameTagMenuItem({
  tagId,
  currentName,
}: {
  tagId: number;
  currentName: string;
}) {
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
      Rename
    </ContextMenuItem>
  );
}
