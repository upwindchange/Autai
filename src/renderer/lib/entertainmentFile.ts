import type { FileMessagePart } from "@assistant-ui/react";

const getFileDataURL = (file: File): Promise<string> =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (error) => reject(error);
    reader.readAsDataURL(file);
  });

/**
 * Convert a text File into an assistant-ui FileMessagePart.
 *
 * Mirrors the text-file branch of `UniversalFileAttachmentAdapter.send()`
 * exactly: read as a data URL, then rewrite the MIME prefix to `text/plain`
 * (avoids unsupported-media-type errors downstream from LLM providers). Kept
 * shared so the wizard and the composer attachment adapter produce IDENTICAL
 * parts regardless of which pick mode (native Electron dialog vs browser
 * <input>) acquired the File — the backend receives the same bytes either way.
 *
 * Reuses `pickFiles()` (src/renderer/lib/filePicker.ts) upstream, which already
 * normalizes both pick modes into identical File objects.
 */
export async function convertFileToFilePart(
  file: File,
): Promise<FileMessagePart> {
  const data = (await getFileDataURL(file)).replace(
    /^data:[^;]+;/,
    "data:text/plain;",
  );
  return {
    type: "file",
    mimeType: "text/plain",
    filename: file.name,
    data,
  };
}
