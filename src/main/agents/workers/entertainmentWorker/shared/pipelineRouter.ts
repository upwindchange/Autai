import log from "electron-log/main";
import { entertainmentService } from "@/services";
import type { EntertainmentConfig } from "@shared";
import type { PipelineScheduler, WorkerLiveness } from "./pipelineScheduler";
import {
  chapteredFileScheduler,
  type ChapteredFilePipeline,
} from "../pipeline1ChapteredFile/scheduler";
import { chapteredInternetScheduler } from "../pipeline2ChapteredInternet/scheduler";
import { nonNovelScheduler } from "../pipeline3NonNovel/scheduler";

const logger = log.scope("Dehydrate:PipelineRouter");

/**
 * Any of the three pipeline schedulers. ① is DECOUPLED — it implements its own
 * `ChapteredFilePipeline` interface, not the shared `PipelineScheduler` that ②
 * and ③ implement, because its execution model (batched outline + reader-driven
 * rewrite, no boot resume) is fundamentally different. The two interfaces are
 * structurally compatible on the reader-facing methods, so the facade below
 * dispatches across the union without forcing them to share a declaration.
 */
type AnyPipeline = ChapteredFilePipeline | PipelineScheduler;

/**
 * Resolve which of the three pipelines owns a thread, from its config. The
 * split is by (novel.type × nonNovelSource):
 *   - chaptered file (file, NOT nonNovelSource)         → ① outline + reader-driven rewrite
 *   - chaptered internet (internet, NOT nonNovelSource) → ② per-chapter fetch + rewrite
 *   - non-novel (file OR internet, nonNovelSource)       → ③ single-piece acquire + rewrite
 * Only `dehydrate` mode is routed today (interactive is a UI placeholder with
 * no backend). A null/missing config or non-dehydrate mode resolves to `null`
 * (the facade methods then no-op).
 */
export function pipelineForConfig(
  config: EntertainmentConfig | null,
): AnyPipeline | null {
  if (!config || config.mode !== "dehydrate") return null;
  if (config.options.nonNovelSource) return nonNovelScheduler;
  if (config.novel.type === "file") return chapteredFileScheduler;
  return chapteredInternetScheduler; // internet, chaptered
}

/**
 * Resolve a thread's pipeline from its persisted config (DB read). Returns null
 * when the thread has no entertainment config or isn't a dehydrate thread.
 */
function pipelineForThread(threadId: string): AnyPipeline | null {
  return pipelineForConfig(entertainmentService.getParsedConfig(threadId));
}

/**
 * The route-facing facade the REST routes and the startup hook talk to. It is
 * NOT `PipelineScheduler` — it deliberately exposes only the generic
 * reader/lifecycle methods every pipeline shares. `runDehydrate` is absent: the
 * loop is kicked via `ensureRange` (the wizard's Start → `ensureWorker` →
 * `POST /worker` → `ensureRange` → `runDehydrate`, and thread-open resume the
 * same way); the `/ingest` route only persists decoded raw text and does NOT
 * call `runDehydrate`. ②/③ have no dehydrate loop. Routes import ONLY this
 * object — no route is a direct pipeline caller.
 */
export interface PipelineRouterFacade {
  ensureRange(threadId: string, from: number, to: number): void;
  /**
   * Fetch-only prefetch — the wizard's internet "Fetch & Continue". Enqueues
   * source acquisition for the window WITHOUT rewriting, so the crawl overlaps
   * with the user configuring options on the next step. Real only on ②; ①/③
   * no-op (no separate fetch phase). Dispatched to the thread's pipeline.
   */
  prefetchRange(threadId: string, from: number, to: number): void;
  retryFailed(threadId: string): number;
  getInfo(threadId: string): WorkerLiveness;
  getInFlight(threadId: string): Set<number>;
  /**
   * Stop all in-flight work on a thread — the IMMEDIATE layer (abort running
   * agent + drain queue + clear in-flight set). Dispatched to the thread's
   * pipeline; no-op when the thread has no worker yet. The `/stop` route calls
   * this AND sets the durable `stopStatus` flag. Called by the reader's Stop
   * button before it abandons the thread for a new one.
   */
  stop(threadId: string): void;
  /**
   * Startup recovery. Fans out to ②/③ only — ① resumes on thread-open, never
   * boot. Threads with `stopStatus === "stopped"` are skipped (user-parked).
   */
  resumeAll(): void;
}

export const pipelineRouter: PipelineRouterFacade = {
  ensureRange: (threadId: string, from: number, to: number) => {
    pipelineForThread(threadId)?.ensureRange(threadId, from, to);
  },

  prefetchRange: (threadId: string, from: number, to: number) => {
    pipelineForThread(threadId)?.prefetchRange(threadId, from, to);
  },

  retryFailed: (threadId: string) =>
    pipelineForThread(threadId)?.retryFailed(threadId) ?? 0,

  getInfo: (threadId: string): WorkerLiveness =>
    pipelineForThread(threadId)?.getInfo(threadId) ?? {
      active: false,
      target: 0,
      pending: 0,
      size: 0,
    },

  getInFlight: (threadId: string): Set<number> =>
    pipelineForThread(threadId)?.getInFlight(threadId) ?? new Set<number>(),

  stop: (threadId: string) => {
    pipelineForThread(threadId)?.stop(threadId);
  },

  resumeAll: () => {
    // ① is intentionally omitted: its outline runs only on upload/thread-open,
    // never on boot (it has no resumeAll). ②/③ resume their interrupted
    // per-thread work here; each scans only the threads it owns.
    logger.info("startup recovery: fanning out to pipelines ②/③");
    chapteredInternetScheduler.resumeAll();
    nonNovelScheduler.resumeAll();
  },
};
