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

export interface PipelineScheduler {
  /**
   * Whole-source preparation kick-off (fire-and-forget). For ① this runs the
   * outliner (split + outline + co-write placeholder). For ②/③ it is a no-op
   * (their source acquisition is driven per-chapter by `ensure`/`processChapter`).
   * Idempotent + re-entrancy-guarded inside each pipeline.
   */
  buildOutlines(threadId: string): Promise<void>;

  /**
   * Ensure the lookahead window [n .. n+LOOKAHEAD] is processed (n first,
   * priority). Idempotent + dedup'd → safe for Next, TOC jumps, and recovery.
   * `n` is the REWRITE OUTPUT sequential number.
   */
  ensure(threadId: string, n: number): void;

  /**
   * Ensure every output in [from, to] that needs work is enqueued — the
   * "process next N / process all" path. `to` may be `Number.MAX_SAFE_INTEGER`
   * for "all"; each pipeline caps it at its known final chapter.
   */
  ensureRange(threadId: string, from: number, to: number): void;

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
   * read-only (does NOT create a worker). Drives the `paused` vs `stopped`
   * distinction in `deriveChapterPhase`.
   */
  getInFlight(threadId: string): Set<number>;

  /**
   * Startup recovery: resume interrupted work for the threads this pipeline
   * owns. Each pipeline filters threads by its own config shape. Safe on a
   * fresh install (no threads → no-op). Called once per pipeline after DB init.
   */
  resumeAll(): void;
}
