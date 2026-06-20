"use client";

import { type PropsWithChildren, useEffect, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import { XIcon, PlusIcon, FileText } from "lucide-react";
import {
  AttachmentPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  useAuiState,
  useAui,
} from "@assistant-ui/react";
import { useShallow } from "zustand/shallow";
import { httpClient } from "@/lib/httpClient";
import { pickFiles } from "@/lib/filePicker";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { FileIconDisplay, FileName, FileSize } from "@/components/ai-chat/file";
import { cn } from "@/lib/utils";

/**
 * Stores filesystem paths for attachments keyed by filename.
 * Populated when files are selected via the native Electron dialog.
 */
const filePathStore = new Map<string, string>();

const useFileSrc = (file: File | undefined) => {
  const [src, setSrc] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!file) {
      setSrc(undefined);
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setSrc(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  return src;
};

const useAttachmentSrc = () => {
  const { file, src } = useAuiState(
    useShallow((s): { file?: File; src?: string } => {
      if (s.attachment.type !== "image") return {};
      if (s.attachment.file) return { file: s.attachment.file };
      const src = s.attachment.content?.filter((c) => c.type === "image")[0]
        ?.image;
      if (!src) return {};
      return { src };
    }),
  );

  return useFileSrc(file) ?? src;
};

type AttachmentPreviewProps = {
  src: string;
};

const AttachmentPreview: FC<AttachmentPreviewProps> = ({ src }) => {
  const [isLoaded, setIsLoaded] = useState(false);
  return (
    <img
      src={src}
      alt="Attachment preview"
      className={cn(
        "block h-auto max-h-[80vh] w-auto max-w-full object-contain",
        isLoaded ?
          "aui-attachment-preview-image-loaded"
        : "aui-attachment-preview-image-loading invisible",
      )}
      onLoad={() => setIsLoaded(true)}
    />
  );
};

const AttachmentPreviewDialog: FC<PropsWithChildren> = ({ children }) => {
  const src = useAttachmentSrc();

  if (!src) return children;

  return (
    <Dialog>
      <DialogTrigger
        className="aui-attachment-preview-trigger cursor-pointer transition-colors hover:bg-accent/50"
        asChild
      >
        {children}
      </DialogTrigger>
      <DialogContent className="aui-attachment-preview-dialog-content p-2 sm:max-w-3xl [&>button]:rounded-full [&>button]:bg-foreground/60 [&>button]:p-1 [&>button]:opacity-100 [&>button]:ring-0! [&_svg]:text-background [&>button]:hover:[&_svg]:text-destructive">
        <DialogTitle className="aui-sr-only sr-only">
          Image Attachment Preview
        </DialogTitle>
        <div className="aui-attachment-preview relative mx-auto flex max-h-[80dvh] w-full items-center justify-center overflow-hidden bg-background">
          <AttachmentPreview src={src} />
        </div>
      </DialogContent>
    </Dialog>
  );
};

const AttachmentThumb: FC = () => {
  const src = useAttachmentSrc();

  return (
    <Avatar className="aui-attachment-tile-avatar h-full w-full rounded-none">
      <AvatarImage
        src={src}
        alt="Attachment preview"
        className="aui-attachment-tile-image object-cover"
      />
      <AvatarFallback>
        <FileText className="aui-attachment-tile-fallback-icon size-8 text-muted-foreground" />
      </AvatarFallback>
    </Avatar>
  );
};

function getFileExtension(filename: string | undefined): string | undefined {
  if (!filename) return undefined;
  const lastDot = filename.lastIndexOf(".");
  if (lastDot < 0 || lastDot === filename.length - 1) return undefined;
  return filename.slice(lastDot + 1).toUpperCase();
}

const DocumentAttachmentCard: FC = () => {
  const aui = useAui();
  const isComposer = aui.attachment.source !== "message";
  const { name, contentType, fileSize } = useAuiState(
    useShallow(
      (s): { name: string; contentType?: string; fileSize?: number } => {
        const att = s.attachment;
        return {
          name: att.name,
          contentType: att.contentType,
          fileSize: att.file?.size,
        };
      },
    ),
  );

  const filePath = filePathStore.get(name);
  const extension = getFileExtension(name);

  const handleReveal = () => {
    if (!filePath) return;
    void httpClient.postCommand("/shell/show-in-folder", { filePath });
  };

  return (
    <AttachmentPrimitive.Root className="aui-attachment-root relative">
      <div
        role={filePath ? "button" : undefined}
        tabIndex={filePath ? 0 : undefined}
        onClick={handleReveal}
        onKeyDown={filePath ? (e) => {
          if (e.key === "Enter" || e.key === " ") handleReveal();
        } : undefined}
        className={cn(
          "aui-attachment-file-card group inline-flex items-stretch overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-all",
          filePath
            ? "cursor-pointer hover:border-primary/25 hover:shadow-md"
            : "hover:opacity-75",
          isComposer && "pr-8",
        )}
      >
        {/* Icon area with distinct background */}
        <div className="flex shrink-0 items-center justify-center bg-blue-100 dark:bg-muted/60 px-2.5 py-2">
          <FileIconDisplay
            mimeType={contentType}
            name={name}
            className="size-10"
          />
        </div>
        {/* Text info */}
        <div className="flex min-w-0 flex-col justify-center gap-0.5 px-3 py-2">
          <FileName className="truncate text-xs font-medium text-foreground">
            {name}
          </FileName>
          <div className="flex items-center gap-1.5">
            {fileSize != null && (
              <FileSize
                bytes={fileSize}
                className="text-[10px] text-muted-foreground"
              />
            )}
            {extension && (
              <span className="inline-flex items-center rounded-lg bg-secondary px-1.5 py-px text-[9px] font-semibold uppercase leading-relaxed tracking-wider text-secondary-foreground">
                {extension}
              </span>
            )}
          </div>
        </div>
      </div>
      {isComposer && <AttachmentRemove />}
    </AttachmentPrimitive.Root>
  );
};

const AttachmentUI: FC = () => {
  const aui = useAui();
  const isComposer = aui.attachment.source !== "message";

  const isImage = useAuiState((s) => s.attachment.type === "image");

  if (!isImage) {
    return (
      <Tooltip>
        <DocumentAttachmentCard />
        <TooltipContent side="top">
          <AttachmentPrimitive.Name />
        </TooltipContent>
      </Tooltip>
    );
  }

  const typeLabel = "Image";

  return (
    <Tooltip>
      <AttachmentPrimitive.Root
        className={cn(
          "aui-attachment-root relative",
          "aui-attachment-root-composer only:*:first:size-24",
        )}
      >
        <AttachmentPreviewDialog>
          <TooltipTrigger asChild>
            <div
              className="aui-attachment-tile size-14 cursor-pointer overflow-hidden rounded-[calc(var(--composer-radius)-var(--composer-padding))] border bg-muted transition-opacity hover:opacity-75"
              role="button"
              tabIndex={0}
              aria-label={`${typeLabel} attachment`}
            >
              <AttachmentThumb />
            </div>
          </TooltipTrigger>
        </AttachmentPreviewDialog>
        {isComposer && <AttachmentRemove />}
      </AttachmentPrimitive.Root>
      <TooltipContent side="top">
        <AttachmentPrimitive.Name />
      </TooltipContent>
    </Tooltip>
  );
};

const AttachmentRemove: FC = () => {
  return (
    <AttachmentPrimitive.Remove asChild>
      <TooltipIconButton
        tooltip="Remove file"
        className="aui-attachment-tile-remove absolute end-1.5 top-1.5 size-3.5 rounded-full bg-white text-muted-foreground opacity-100 shadow-sm hover:bg-white! [&_svg]:text-black hover:[&_svg]:text-destructive"
        side="top"
      >
        <XIcon className="aui-attachment-remove-icon size-3 dark:stroke-[2.5px]" />
      </TooltipIconButton>
    </AttachmentPrimitive.Remove>
  );
};

export const UserMessageAttachments: FC = () => {
  return (
    <div className="aui-user-message-attachments-end col-span-full col-start-1 row-start-1 flex w-full flex-row justify-end gap-2">
      <MessagePrimitive.Attachments>
        {() => <AttachmentUI />}
      </MessagePrimitive.Attachments>
    </div>
  );
};

export const ComposerAttachments: FC = () => {
  return (
    <div className="aui-composer-attachments flex w-full flex-row items-center gap-2 overflow-x-auto empty:hidden">
      <ComposerPrimitive.Attachments>
        {() => <AttachmentUI />}
      </ComposerPrimitive.Attachments>
    </div>
  );
};

export const ComposerAddAttachment: FC = () => {
  const { t } = useTranslation("common");
  const aui = useAui();

  const handleClick = async () => {
    for (const { file, fsPath, name } of await pickFiles()) {
      if (fsPath) filePathStore.set(name, fsPath);
      await aui.composer().addAttachment(file);
    }
  };

  return (
    <TooltipIconButton
      tooltip={t("composer.addAttachment")}
      side="bottom"
      variant="ghost"
      size="icon"
      className="aui-composer-add-attachment size-8 rounded-full p-1 font-semibold text-xs hover:bg-muted-foreground/15 dark:border-muted-foreground/15 dark:hover:bg-muted-foreground/30"
      aria-label={t("composer.addAttachment")}
      onClick={handleClick}
    >
      <PlusIcon className="aui-attachment-add-icon size-5 stroke-[1.5px]" />
    </TooltipIconButton>
  );
};
