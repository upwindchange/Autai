"use client";

import { memo } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { DownloadIcon } from "lucide-react";
import { FileIcon, defaultStyles } from "react-file-icon";
import type { FileMessagePartComponent } from "@assistant-ui/react";
import { cn } from "@/lib/utils";

const fileVariants = cva(
  "aui-file-root inline-flex items-center gap-3 rounded-lg transition-colors",
  {
    variants: {
      variant: {
        outline: "border border-border hover:bg-muted/50",
        ghost: "hover:bg-muted/50",
        muted: "bg-muted/50 hover:bg-muted/70",
      },
      size: {
        sm: "px-2.5 py-1.5 text-xs",
        default: "px-3 py-2 text-sm",
        lg: "px-4 py-3 text-base",
      },
    },
    defaultVariants: {
      variant: "outline",
      size: "default",
    },
  },
);

function getMimeTypeGlyphType(
  mimeType: string,
): React.ComponentProps<typeof FileIcon>["type"] | undefined {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType === "application/pdf") return "acrobat";
  if (mimeType === "application/json") return "code";
  if (mimeType.startsWith("text/")) return "document";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  if (
    mimeType === "application/zip" ||
    mimeType === "application/x-zip-compressed" ||
    mimeType === "application/gzip" ||
    mimeType === "application/x-tar"
  )
    return "compressed";
  if (
    mimeType === "application/vnd.ms-excel" ||
    mimeType.startsWith(
      "application/vnd.openxmlformats-officedocument.spreadsheet",
    )
  )
    return "spreadsheet";
  if (
    mimeType === "application/vnd.ms-powerpoint" ||
    mimeType.startsWith(
      "application/vnd.openxmlformats-officedocument.presentationml",
    )
  )
    return "presentation";
  if (
    mimeType === "application/msword" ||
    mimeType.startsWith(
      "application/vnd.openxmlformats-officedocument.wordprocessingml",
    )
  )
    return "document";
  return undefined;
}

function getFileExtension(filename: string | undefined): string | undefined {
  if (!filename) return undefined;
  const lastDot = filename.lastIndexOf(".");
  if (lastDot < 0 || lastDot === filename.length - 1) return undefined;
  return filename.slice(lastDot + 1).toLowerCase();
}

function getBase64Size(base64: string): number {
  const commaIndex = base64.indexOf(",");
  const base64Data = commaIndex >= 0 ? base64.slice(commaIndex + 1) : base64;
  const padding = (base64Data.match(/=/g) || []).length;
  return Math.floor((base64Data.length * 3) / 4) - padding;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type FileRootProps = React.ComponentProps<"div"> &
  VariantProps<typeof fileVariants>;

function FileRoot({
  className,
  variant,
  size,
  children,
  ...props
}: FileRootProps) {
  return (
    <div
      data-slot="file-root"
      data-variant={variant}
      data-size={size}
      className={cn(fileVariants({ variant, size, className }))}
      {...props}
    >
      {children}
    </div>
  );
}

type FileIconDisplayProps = React.ComponentProps<"span"> & {
  mimeType?: string;
  name?: string;
};

function FileIconDisplay({
  mimeType,
  name: fileName,
  className,
  children,
  ...props
}: FileIconDisplayProps) {
  const extension = getFileExtension(fileName);
  const extensionStyles = extension ? defaultStyles[extension] : undefined;

  // Prefer extension-based styles (gives accurate icon + label color)
  // Fall back to MIME-type-based glyph type
  // Ultimate fallback: plain file icon
  const iconProps =
    extensionStyles ? { extension, ...extensionStyles }
    : mimeType ? { type: getMimeTypeGlyphType(mimeType) }
    : {};

  return (
    <span
      data-slot="file-icon"
      className={cn("shrink-0 [&_svg]:size-full", className)}
      {...props}
    >
      {children ?? <FileIcon {...iconProps} />}
    </span>
  );
}

function FileName({
  className,
  children,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="file-name"
      className={cn("min-w-0 flex-1 truncate font-medium", className)}
      {...props}
    >
      {children || "Unnamed file"}
    </span>
  );
}

type FileSizeProps = React.ComponentProps<"span"> & {
  bytes: number;
};

function FileSize({ bytes, className, ...props }: FileSizeProps) {
  return (
    <span
      data-slot="file-size"
      className={cn("shrink-0 text-muted-foreground", className)}
      {...props}
    >
      {formatFileSize(bytes)}
    </span>
  );
}

type FileDownloadProps = Omit<React.ComponentProps<"a">, "href"> & {
  data: string;
  mimeType: string;
  filename?: string;
};

function FileDownload({
  data,
  mimeType,
  filename,
  className,
  children,
  ...props
}: FileDownloadProps) {
  const href =
    data.startsWith("data:") ? data : `data:${mimeType};base64,${data}`;

  return (
    <a
      data-slot="file-download"
      href={href}
      download={filename || "download"}
      className={cn(
        "shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
        className,
      )}
      {...props}
    >
      {children || <DownloadIcon className="size-4" />}
    </a>
  );
}

const FileImpl: FileMessagePartComponent = ({ filename, data, mimeType }) => {
  const bytes = getBase64Size(data);

  return (
    <FileRoot>
      <FileIconDisplay mimeType={mimeType} name={filename} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <FileName>{filename}</FileName>
        <FileSize bytes={bytes} className="text-xs" />
      </div>
      <FileDownload
        data={data}
        mimeType={mimeType}
        {...(filename !== undefined && { filename })}
      />
    </FileRoot>
  );
};

const File = memo(FileImpl) as unknown as FileMessagePartComponent & {
  Root: typeof FileRoot;
  Icon: typeof FileIconDisplay;
  Name: typeof FileName;
  Size: typeof FileSize;
  Download: typeof FileDownload;
};

File.displayName = "File";
File.Root = FileRoot;
File.Icon = FileIconDisplay;
File.Name = FileName;
File.Size = FileSize;
File.Download = FileDownload;

export {
  File,
  FileRoot,
  FileIconDisplay,
  FileName,
  FileSize,
  FileDownload,
  fileVariants,
  getBase64Size,
  formatFileSize,
};
