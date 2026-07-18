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
 * reader/lifecycle methods every pipeline shares. `buildOutlines` is absent:
 * the upload route calls `chapteredFileScheduler.buildOutlines` directly (upload
 * is unambiguously a file thread), and ②/③ have no outline step. Routes import
 * ONLY this object; the upload route is the sole direct pipeline caller.
 */
export interface PipelineRouterFacade {
  ensureRange(threadId: string, from: number, to: number): void;
  retryFailed(threadId: string): number;
  getInfo(threadId: string): WorkerLiveness;
  getInFlight(threadId: string): Set<number>;
  /** Startup recovery. Fans out to ②/③ only — ① resumes on thread-open, never boot. */
  resumeAll(): void;
}

export const pipelineRouter: PipelineRouterFacade = {
  ensureRange: (threadId: string, from: number, to: number) => {
    pipelineForThread(threadId)?.ensureRange(threadId, from, to);
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

  resumeAll: () => {
    // ① is intentionally omitted: its outline runs only on upload/thread-open,
    // never on boot (it has no resumeAll). ②/③ resume their interrupted
    // per-thread work here; each scans only the threads it owns.
    logger.info("startup recovery: fanning out to pipelines ②/③");
    chapteredInternetScheduler.resumeAll();
    nonNovelScheduler.resumeAll();
  },
};
