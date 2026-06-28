/**
 * Prepare a picked novel file for upload so the BACKEND can detect its encoding.
 *
 * Native Electron picker yields a filesystem path → send `fsPath`; the backend
 * reads the raw bytes and detects/decodes the encoding (jschardet + iconv-lite).
 * Browser fallback (no path) → encode the bytes as base64; the backend decodes
 * base64 → bytes → detects encoding. Replaces the renderer's UTF-8-only
 * `File.text()`.
 */
export interface FileTransfer {
  fsPath?: string;
  fileBytesBase64?: string;
}

export async function toFileTransfer(input: {
  fsPath?: string;
  file: File;
}): Promise<FileTransfer> {
  if (input.fsPath) return { fsPath: input.fsPath };
  const bytes = new Uint8Array(await input.file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return { fileBytesBase64: btoa(binary) };
}
