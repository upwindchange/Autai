import { isNativeRenderer } from "@/lib/env";
import { httpClient } from "@/lib/httpClient";

export type PickedFile = { file: File; fsPath?: string; name: string };

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

// Unified entry point. Native mode keeps the Electron dialog over HTTP; in a
// browser we fall back to a hidden file input. Both branches yield File objects
// (the attachment adapter consumes them unchanged); the filesystem path is only
// available in native mode.
export async function pickFiles(): Promise<PickedFile[]> {
  if (isNativeRenderer()) {
    const results = await httpClient.postJSON<
      Array<{ path: string; name: string; data: string; mimeType: string }>
    >("/dialog/open-files");
    if (!Array.isArray(results)) return [];
    return results.map(({ path: fsPath, name, data, mimeType }) => ({
      file: new File(
        [Uint8Array.from(atob(data), (c) => c.charCodeAt(0))],
        name,
        { type: mimeType },
      ),
      fsPath,
      name,
    }));
  }
  const files = await pickViaBrowser();
  return files.map((file) => ({ file, name: file.name }));
}
