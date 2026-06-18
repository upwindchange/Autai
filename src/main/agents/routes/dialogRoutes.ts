import { Hono } from "hono";
import { BrowserWindow, dialog } from "electron";
import path from "node:path";
import { readFile } from "node:fs/promises";
import log from "electron-log/main";

const logger = log.scope("ApiServer:Dialog");
export const dialogRoutes = new Hono();

const MIME_MAP: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
  pdf: "application/pdf",
  json: "application/json",
  xml: "application/xml",
  zip: "application/zip",
  tar: "application/x-tar",
  gz: "application/gzip",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  mp4: "video/mp4",
  webm: "video/webm",
  txt: "text/plain",
  csv: "text/csv",
  html: "text/html",
  md: "text/markdown",
  js: "text/javascript",
  ts: "text/typescript",
  css: "text/css",
};

// POST /dialog/open-files — native file picker, returns base64-encoded files
dialogRoutes.post("/open-files", async (c) => {
  try {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return c.json([]);

    const result = await dialog.showOpenDialog(win, {
      properties: ["openFile", "multiSelections"],
    });

    if (result.canceled || !result.filePaths.length) return c.json([]);

    const files = await Promise.all(
      result.filePaths.map(async (filePath) => {
        const buffer = await readFile(filePath);
        const ext = filePath.slice(filePath.lastIndexOf(".") + 1).toLowerCase();
        const mimeType = MIME_MAP[ext] ?? "application/octet-stream";
        return {
          path: filePath,
          name: path.basename(filePath),
          data: buffer.toString("base64"),
          mimeType,
        };
      }),
    );
    return c.json(files);
  } catch (error) {
    logger.error("Error opening file dialog:", error);
    return c.json({ error: "Failed to open files" }, 500);
  }
});
