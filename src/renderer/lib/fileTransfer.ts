/**
 * Prepare a picked novel file for upload so the BACKEND can detect its encoding.
 *
 * Native Electron picker yields a filesystem path → send `fsPath`; the backend
 * reads the raw bytes and detects/decodes the encoding (jschardet + iconv-lite).
 * Browser fallback (no path) → encode the bytes as base64; the backend decodes
 * base64 → bytes → detects encoding. Replaces the renderer's UTF-8-only
 * `File.text()`.
 *
 * `file` is optional because the native picker can now skip reading the bytes
 * into the renderer (the wizard passes `withBytes:false`): when a `fsPath` is
 * present it short-circuits and never touches `file`.
 */
export interface FileTransfer {
  fsPath?: string;
  fileBytesBase64?: string;
}

export async function toFileTransfer(input: {
  fsPath?: string;
  file?: File;
}): Promise<FileTransfer> {
  if (input.fsPath) return { fsPath: input.fsPath };
  // No path → the bytes MUST be present (browser fallback). The caller is
  // responsible for not calling this without one of {fsPath, file}.
  if (!input.file) throw new Error("toFileTransfer requires fsPath or file");
  const bytes = new Uint8Array(await input.file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return { fileBytesBase64: btoa(binary) };
}
