import { isNativeRenderer } from "@/lib/env";
import { httpClient } from "@/lib/httpClient";

// `file` is optional: in native mode a caller that only needs the filesystem
// path (the wizard's novel pick) can pass `withBytes: false` and skip the
// backend reading + base64-encoding the whole file just to throw it away.
// Callers that need the bytes (chat attachments) pass `withBytes: true` (the
// default) and `file` is always present.
export type PickedFile = { file?: File; fsPath?: string; name: string };

// One hidden <input type="file"> reused across picks. Lives at module scope (not
// component state) so it survives React unmounts and StrictMode double-invokes.
// Offscreen rather than display:none — some browsers refuse to open the picker
// on a display:none element.
let fileInput: HTMLInputElement | null = null;

// Resolves a pick that is still pending when the next one starts — covers
// browsers that never fire `cancel` when the user dismisses the dialog.
let settlePending: ((files: File[]) => void) | null = null;

function pickViaBrowser(): Promise<File[]> {
  settlePending?.([]);
  return new Promise((resolve) => {
    if (!fileInput) {
      const el = document.createElement("input");
      el.type = "file";
      el.multiple = true;
      el.style.cssText = "position:fixed;top:-9999px;left:-9999px;opacity:0;";
      document.body.appendChild(el);
      fileInput = el;
    }
    const el = fileInput;
    el.value = ""; // allow re-selecting the same file
    settlePending = resolve;
    const done = (files: File[]) => {
      el.removeEventListener("change", onChange);
      el.removeEventListener("cancel", onCancel);
      settlePending = null;
      resolve(files);
    };
    const onChange = () => done(el.files ? Array.from(el.files) : []);
    const onCancel = () => done([]);
    el.addEventListener("change", onChange);
    el.addEventListener("cancel", onCancel);
    el.click();
  });
}

// Unified entry point. Native mode uses the Electron dialog over HTTP; in a
// browser we fall back to a hidden file input. The filesystem path is only
// available in native mode. `withBytes` (default true) controls whether native
// mode also returns the file contents — false keeps it to a cheap { path, name }
// round trip for callers that will only use the path (the wizard's novel pick
// sends `fsPath` to the backend, which reads the file itself). The browser
// branch always yields a `File` regardless, since it cannot expose a path.
export async function pickFiles(
  options: { withBytes?: boolean } = {},
): Promise<PickedFile[]> {
  const { withBytes = true } = options;
  if (isNativeRenderer()) {
    // `data`/`mimeType` are only present when withBytes was true server-side.
    const results = await httpClient.postJSON<
      Array<{
        path: string;
        name: string;
        data?: string;
        mimeType?: string;
      }>
    >("/dialog/open-files", { withBytes });
    if (!Array.isArray(results)) return [];
    return results.map(({ path: fsPath, name, data, mimeType }) =>
      withBytes && data != null ?
        {
          file: new File(
            [Uint8Array.from(atob(data), (c) => c.charCodeAt(0))],
            name,
            { type: mimeType ?? "application/octet-stream" },
          ),
          fsPath,
          name,
        }
      : { fsPath, name },
    );
  }
  const files = await pickViaBrowser();
  return files.map((file) => ({ file, name: file.name }));
}
