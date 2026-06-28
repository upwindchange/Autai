// Retired. The dehydration pipeline now lives in:
//   - ./ingest      — real file encoding detection (iconv) + chapter splitting
//   - ./scheduler   — per-thread p-queue lookahead: acquire 原文 → rewrite 重写
// The REST chapter route (entertainmentChapterRoutes.ts) drives the scheduler
// directly; there is no longer a single fire-and-forget `runDehydrate` entry.
export {};
