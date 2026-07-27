/**
 * The contract every entertainment pipeline scheduler implements. After the
 * 3-pipeline refactor, each pipeline (① chaptered-file outline+co-write,
 * ② chaptered-internet fetch+rewrite, ③ non-novel file/internet) owns an
 * INDEPENDENT scheduling core — there is NO shared scheduler. `pipelineRouter`
 * (./pipelineRouter.ts) inspects a thread's config, picks the right pipeline's
 * scheduler, and delegates — so every scheduler must expose these identical
 * seven methods. The REST routes (`entertainmentRoutes`) and the startup hook
 * (`main/index.ts`) only ever talk to the router, never a pipeline directly.
 *
 * Concurrency model (replicated per pipeline — NOT shared): each thread gets a
 * serial p-queue (concurrency 1) lazily, with an `inFlight: Set<number>`
 * dedup/lookup. The semantics of the number in that set, and of the
 * `chapterNumber`/`n` parameters below, are the pipeline's REWRITE OUTPUT
 * sequential number (the reader's spine key), NOT a source-chapter number:
 *  - ② (1:1): rewrite output N == source chapter N, so the numbers coincide.
 *  - ① (co-writing window): rewrite output N may cover source chapters
 *    [start, end]; the spine is the output's own 1,2,3,… sequence.
 *  - ③ (single non-novel piece): exactly one output, number 1.
 *
 * `resumeAll()` is the startup recovery entry — each pipeline scans only the
 * threads it owns (filtered by config) and resumes interrupted work.
 */

/** Worker liveness — backs the `GET /worker` REST route. */
export interface WorkerLiveness {
  active: boolean;
  target: number;
  pending: number;
  size: number;
}

/**
 * Chapters kept ready ahead of the reader's current position — the reader-poll
 * lookahead window. Shared by pipelines ① (chaptered-file) and ② (chaptered-
 * internet), which both translate "reader is on chapter n" into
 * `ensureRange(n, n + LOOKAHEAD)`. Pipeline ③ (non-novel) has a single output
 * and ignores the upper bound, so this value is inert for it. Formerly a
 * per-pipeline private constant duplicated as `10` in ①/② — hoisted here so the
 * REST route and the schedulers agree on one window size.
 */
export const LOOKAHEAD = 10;

export interface PipelineScheduler {
  /**
   * Whole-source preparation kick-off (fire-and-forget). For ① this runs the
   * outliner (split + outline + co-write placeholder). For ②/③ it is a no-op
   * (their source acquisition is driven per-chapter by `ensure`/`processChapter`).
   * Idempotent + re-entrancy-guarded inside each pipeline.
   */
  buildOutlines(threadId: string): Promise<void>;

  /**
   * Ensure every output in [from, to] that needs work is enqueued — the
   * "process next N / process all" path, AND the reader-poll path: the route
   * calls `ensureRange(n, n + LOOKAHEAD)` to keep a prefetch window ready.
   * `to` may be `Number.MAX_SAFE_INTEGER` for "all"; each pipeline caps it at
   * its known final chapter.
   */
  ensureRange(threadId: string, from: number, to: number): void;

  /**
   * Ensure every chapter in [from, to] that still needs FETCHING is enqueued —
   * a fetch-only path that runs AHEAD of rewrite. Meaningful ONLY for ②
   * (chaptered-internet), where source acquisition is a separate network phase
   * from rewrite; ③ no-ops (its single-piece acquire is bundled into its one
   * rewrite pass) and ① no-ops (file decode happens at `/ingest`, no fetch
   * phase). The wizard's internet "Fetch & Continue" calls this to overlap the
   * per-chapter crawl with the user configuring options on the next step.
   *
   * Unlike `ensureRange`, this does NOT gate on the persisted `stopStatus`:
   * there is none to gate on at prefetch time (the thread was never parked), and
   * `resumeAll` already skips zero-rewrite threads so a prefetched-but-not-yet-
   * started thread can't be auto-resumed on boot. The rewriter is kicked later
   * by the wizard's "Start" (→ `ensureRange`), whose `needsWork` + the fetch
   * guard in `processChapter` make it skip already-fetched chapters and go
   * straight to rewrite — so the two entry points synchronize purely through
   * the `source_chapters` row statuses.
   */
  prefetchRange(threadId: string, from: number, to: number): void;

  /**
   * Re-enqueue every errored output for the thread. Returns the count actually
   * enqueued (the only path that retries failed chapters; `needsWork` treats
   * "error" as terminal).
   */
  retryFailed(threadId: string): number;

  /** Liveness + target — backs `GET /worker`. */
  getInfo(threadId: string): WorkerLiveness;

  /**
   * Snapshot of the output numbers currently scheduled (enqueued or running),
   * read-only (does NOT create a worker). Drives the `paused` vs `pending`
   * distinction in `deriveChapterStatus` (a chapter in the set is `paused`;
   * one not in the set and not user-stopped is `pending`).
   */
  getInFlight(threadId: string): Set<number>;

  /**
   * Stop ALL in-flight work for a thread — the IMMEDIATE layer: abort the
   * running agent call, drain the pending queue, and clear the in-flight set.
   * The reader's Stop button calls this (via the `/stop` route) before
   * abandoning the thread. No-op for a thread that has never been touched. The
   * DURABLE layer is the persisted `entertainment_configs.stopStatus = "stopped"`
   * flag, set by the same route, which gates `ensureRange`/`buildOutlines`/
   * `runDehydrate` so the reader poll can't resurrect the work. The flag is
   * cleared ONLY by an explicit user "go" (Process/Redo/wizard Start); until
   * then a stopped thread stays stopped across reload and reopen. A row left
   * mid-run self-heals once the flag clears (its `"rewriting"`/`"fetching"`
   * dirty flag is redone by `needsWork`). This method does NOT delete data or
   * mark anything terminal.
   */
  stop(threadId: string): void;

  /**
   * Startup recovery: resume interrupted work for the threads this pipeline
   * owns. Each pipeline filters threads by its own config shape. Safe on a
   * fresh install (no threads → no-op). Called once per pipeline after DB init.
   */
  resumeAll(): void;
}
