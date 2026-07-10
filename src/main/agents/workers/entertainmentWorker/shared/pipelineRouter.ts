import log from "electron-log/main";
import { entertainmentService } from "@/services";
import type { EntertainmentConfig } from "@shared";
import type { PipelineScheduler, WorkerLiveness } from "./pipelineScheduler";
import { chapteredFileScheduler } from "../pipeline1ChapteredFile/scheduler";
import { chapteredInternetScheduler } from "../pipeline2ChapteredInternet/scheduler";
import { nonNovelScheduler } from "../pipeline3NonNovel/scheduler";

const logger = log.scope("Dehydrate:PipelineRouter");

/**
 * Resolve which of the three pipelines owns a thread, from its config. The
 * split is by (novel.type × nonNovelSource):
 *   - chaptered file (file, NOT nonNovelSource)        → ① outline + co-write
 *   - chaptered internet (internet, NOT nonNovelSource) → ② per-chapter fetch + rewrite
 *   - non-novel (file OR internet, nonNovelSource)      → ③ single-piece acquire + rewrite
 * Only `dehydrate` mode is routed today (interactive is a UI placeholder with
 * no backend). A null/missing config or non-dehydrate mode resolves to `null`
 * (the router methods then no-op).
 *
 * The three schedulers are INDEPENDENT — each owns its own workers Map,
 * p-queues, and resume logic. This object is a thin dispatcher that exposes the
 * same 7-method `PipelineScheduler` surface so the REST routes and the startup
 * hook talk to ONE entry point and never know which pipeline they hit.
 */
export function pipelineForConfig(
  config: EntertainmentConfig | null,
): PipelineScheduler | null {
  if (!config || config.mode !== "dehydrate") return null;
  if (config.options.nonNovelSource) return nonNovelScheduler;
  if (config.novel.type === "file") return chapteredFileScheduler;
  return chapteredInternetScheduler; // internet, chaptered
}

/**
 * Resolve a thread's pipeline from its persisted config (DB read). Returns null
 * when the thread has no entertainment config or isn't a dehydrate thread.
 */
function pipelineForThread(threadId: string): PipelineScheduler | null {
  return pipelineForConfig(entertainmentService.getParsedConfig(threadId));
}

/**
 * The single entertainment-scheduling entry point. Dispatches every call to the
 * owning pipeline's scheduler. Routes (`entertainmentRoutes`) and startup
 * (`main/index.ts`) import ONLY this object — never a pipeline directly.
 *
 * `resumeAll` fans out to all three pipelines (each scans only its own threads).
 */
export const pipelineRouter: PipelineScheduler & {
  resumeAll(): void;
} = {
  buildOutlines: (threadId: string) => {
    const p = pipelineForThread(threadId);
    if (!p) return Promise.resolve();
    return p.buildOutlines(threadId);
  },

  ensure: (threadId: string, n: number) => {
    pipelineForThread(threadId)?.ensure(threadId, n);
  },

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
    // Each pipeline scans only the threads it owns. Fan out in order; each is
    // fire-and-forget internally.
    logger.info("startup recovery: fanning out to all pipelines");
    chapteredFileScheduler.resumeAll();
    chapteredInternetScheduler.resumeAll();
    nonNovelScheduler.resumeAll();
  },
};
