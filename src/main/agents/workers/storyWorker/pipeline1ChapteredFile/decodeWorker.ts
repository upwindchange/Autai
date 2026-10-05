/**
 * Worker entry — runs the CPU-bound novel decode (encoding detection + iconv
 * decode + normalize) OFF the Electron main-process event loop. The main thread
 * spawns this, hands it bytes (or an fsPath), and awaits one message back.
 *
 * Why a worker: jschardet.detect + iconv.decode + normalizeText are all
 * synchronous and walk the full multi-MB text. Running them inline in the
 * ingest route handler blocked the one event loop — freezing the window, the
 * Start-button animation, and the rest of the UI for hundreds of ms to seconds
 * on large GBK novels. `worker_threads` is the only thing that actually moves
 * CPU work off the loop; p-queue would only serialize it.
 *
 * Pure function: bytes in → normalized string out. No DB, no Electron, no
 * state. The string crosses the boundary via postMessage (structured clone of a
 * few MB is single-digit ms — negligible next to the decode itself).
 *
 * Receives `{ fsPath?, base64? }` via workerData, posts back
 * `{ ok: true, decoded }` or `{ ok: false, error }`.
 */
import { readFile } from "node:fs/promises";
import { parentPort, workerData } from "node:worker_threads";
import jschardet from "jschardet";
import * as iconv from "iconv-lite";

// Inlined copy of `normalizeText` (utils/textNormalize.ts). Imported directly
// rather than via the `@agents/utils` barrel so the worker — a separate Vite
// entry — gets a self-contained bundle instead of pulling the whole utils
// barrel (PQueue, telemetry, toolUtils, …) into a multi-MB shared chunk. Keep
// this in sync with the canonical copy; it is a pure 6-line transform with no
// imports of its own, so the two cannot drift in behavior.
function normalizeText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/\r\n?/gu, "\n")
    .replace(/[^\S\n]+/gu, " ")
    .replace(/ *\n */gu, "\n")
    .replace(/\n{2,}/gu, "\n")
    .trim();
}

// Normalize jschardet aliases to iconv-lite encoding names.
function normalizeEncoding(enc: string): string {
  const e = enc.toUpperCase();
  if (e === "GB2312" || e === "GB18030") return "GBK"; // GB2312 is a GBK subset
  if (e === "ASCII" || e === "ISO-8859-1" || e === "LATIN1") return "UTF-8";
  return enc;
}

async function run(): Promise<void> {
  const { fsPath, base64 } = workerData as {
    fsPath?: string;
    base64?: string;
  };
  const bytes =
    fsPath ? await readFile(fsPath) : Buffer.from(base64 ?? "", "base64");

  const detected = jschardet.detect(bytes)?.encoding ?? "utf8";
  const encoding = normalizeEncoding(detected);
  let decoded: string;
  try {
    decoded = iconv.decode(bytes, encoding);
  } catch {
    // Unsupported/ambiguous encoding → best-effort utf8 rather than failing.
    decoded = bytes.toString("utf8");
  }
  parentPort?.postMessage({ ok: true, decoded: normalizeText(decoded) });
}

run().catch((err: unknown) => {
  parentPort?.postMessage({
    ok: false,
    error: err instanceof Error ? err.message : String(err),
  });
});
