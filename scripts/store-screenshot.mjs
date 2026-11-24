#!/usr/bin/env node
/**
 * Interactive store-screenshot capture over the Chrome DevTools Protocol.
 *
 * Captures the renderer surface itself — never the OS window — so the output
 * is exactly <width>*<scale> x <height>*<scale> pixels: no title bar, window
 * borders, or DWM shadow that screen-capture tools add. With
 * `--size 1440x900 --scale 2` the PNGs are exactly 2880x1800 (the Mac App
 * Store retina size); `--size 1280x800 --scale 2` gives 2560x1600, etc.
 *
 * Usage (two terminals):
 *   pnpm dev -- --remote-debugging-port=9333 --window-size=1440x900 --frameless
 *   node scripts/store-screenshot.mjs --port 9333 --size 1440x900 --scale 2 --out docs/screenshots/store
 *
 * Type a base filename to capture (e.g. `欢迎界面`), empty input quits.
 * Note: only the main renderer surface is captured — screenshots of split-
 * view browser tabs (WebContentsView) are out of scope.
 */
import { createInterface } from "node:readline/promises";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const port = parseInt(flag("port", "9333"), 10);
const [width, height] = flag("size", "1440x900").split(/[xX]/).map(Number);
const scale = parseFloat(flag("scale", "2"));
const outDir = flag("out", "docs/screenshots/store");

if (!(width >= 1 && height >= 1 && scale > 0)) {
  console.error(`Invalid --size/--scale: ${width}x${height} @${scale}`);
  process.exit(1);
}
const pxW = Math.round(width * scale);
const pxH = Math.round(height * scale);

let targets;
try {
  targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
} catch {
  console.error(
    `Cannot reach CDP on port ${port}. Start the app first:\n` +
      `  pnpm dev -- --remote-debugging-port=${port} --window-size=${width}x${height} --frameless`,
  );
  process.exit(1);
}
const page =
  targets.find((t) => t.type === "page" && /index\.html|localhost:\d+/.test(t.url)) ??
  targets.find((t) => t.type === "page");
if (!page?.webSocketDebuggerUrl) {
  console.error("No attachable page target found on the CDP endpoint.");
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = () => reject(new Error(`WebSocket connect failed: ${page.webSocketDebuggerUrl}`));
});

const pending = new Map();
let nextId = 0;
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  const waiter = msg.id != null ? pending.get(msg.id) : undefined;
  if (waiter) {
    pending.delete(msg.id);
    msg.error ? waiter.reject(new Error(msg.error.message)) : waiter.resolve(msg.result);
  }
};
function cdp(method, params = {}) {
  const id = ++nextId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

// Render the page at exactly width x height CSS pixels with the requested
// device scale; captureScreenshot then returns pxW x pxH pixels, always.
await cdp("Emulation.setDeviceMetricsOverride", {
  width,
  height,
  deviceScaleFactor: scale,
  mobile: false,
});

await mkdir(outDir, { recursive: true });
console.log(`Capturing ${width}x${height} CSS @${scale}x -> ${pxW}x${pxH} px into ${outDir}`);

const rl = createInterface({ input: process.stdin, output: process.stdout });
for (;;) {
  const name = (await rl.question("filename (no extension, empty quits): ")).trim();
  if (!name) break;
  try {
    const { data } = await cdp("Page.captureScreenshot", { format: "png" });
    const file = path.join(outDir, `${name}.png`);
    await writeFile(file, Buffer.from(data, "base64"));
    console.log(`saved ${file} (${pxW}x${pxH})`);
  } catch (err) {
    console.error(`capture failed: ${err.message}`);
  }
}

await cdp("Emulation.clearDeviceMetricsOverride").catch(() => {});
rl.close();
ws.close();
