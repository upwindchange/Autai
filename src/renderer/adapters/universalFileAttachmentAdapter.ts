import type {
  AttachmentAdapter,
  PendingAttachment,
  CompleteAttachment,
} from "@assistant-ui/react";

const TEXT_FILE_MAX_BYTES = 2 * 1024 * 1024; // 2MB
const BINARY_FILE_MAX_BYTES = 20 * 1024 * 1024; // 20MB

const BINARY_MIME_PREFIXES = [
  "image/",
  "audio/",
  "video/",
  "application/zip",
  "application/x-rar",
  "application/x-tar",
  "application/x-gzip",
  "application/x-bzip",
  "application/x-7z",
  "application/gzip",
  "application/octet-stream",
  "application/x-msdownload",
  "application/x-executable",
  "application/x-shockwave",
  "application/x-iso9660-image",
  "application/x-apple-diskimage",
];

function isPdfFile(file: File): boolean {
  return (
    file.type === "application/pdf" ||
    file.name.toLowerCase().endsWith(".pdf")
  );
}

function isBinaryMimeType(mimeType: string): boolean {
  if (!mimeType) return false;
  return BINARY_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix));
}

const getFileText = (file: File): Promise<string> =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (error) => reject(error);
    reader.readAsText(file);
  });

const getFileDataURL = (file: File): Promise<string> =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (error) => reject(error);
    reader.readAsDataURL(file);
  });

export class UniversalFileAttachmentAdapter implements AttachmentAdapter {
  public accept = "*";

  public async add(state: { file: File }): Promise<PendingAttachment> {
    const { file } = state;
    const isBinary = isBinaryMimeType(file.type) && !isPdfFile(file);
    const maxBytes = isBinary ? BINARY_FILE_MAX_BYTES : TEXT_FILE_MAX_BYTES;

    if (file.size > maxBytes) {
      return {
        id: file.name,
        type: "document",
        name: file.name,
        contentType: file.type || undefined,
        file,
        status: { type: "incomplete", reason: "error" },
      };
    }

    return {
      id: file.name,
      type: "document",
      name: file.name,
      contentType: file.type || undefined,
      file,
      status: { type: "requires-action", reason: "composer-send" },
    };
  }

  public async send(
    attachment: PendingAttachment,
  ): Promise<CompleteAttachment> {
    const { file } = attachment;

    // PDF: send as base64 file part
    if (isPdfFile(file)) {
      const data = await getFileDataURL(file);
      return {
        ...attachment,
        status: { type: "complete" },
        content: [
          {
            type: "file",
            mimeType: "application/pdf",
            filename: attachment.name,
            data,
          },
        ],
      };
    }

    // Other binary files: send as base64 file part
    if (isBinaryMimeType(file.type)) {
      const data = await getFileDataURL(file);
      return {
        ...attachment,
        status: { type: "complete" },
        content: [
          {
            type: "file",
            mimeType: file.type || "application/octet-stream",
            filename: attachment.name,
            data,
          },
        ],
      };
    }

    // Text-like files: read as text and wrap in attachment tags
    const text = await getFileText(file);
    return {
      ...attachment,
      status: { type: "complete" },
      content: [
        {
          type: "text",
          text: `<attachment name="${attachment.name}">\n${text}\n</attachment>`,
        },
      ],
    };
  }

  public async remove() {
    // noop
  }
}
