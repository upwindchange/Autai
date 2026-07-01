import PQueue from "p-queue";
import log from "electron-log/main";
import { entertainmentService } from "@/services";
import type { EntertainmentConfig } from "@shared";

const logger = log.scope("Dehydrate:Scheduler");

/** Chapters kept ready ahead of the reader's current position (point 4/7). */
const LOOKAHEAD = 10;
/** Per-step stub work duration (acquire and rewrite each take this long). */
const STUB_DELAY_MS = 2500;
/** Hard cap on a single chapter job — bounds stuck stubs so they self-heal. */
const JOB_TIMEOUT_MS = 5 * 60_000;

interface WorkerLiveness {
  active: boolean;
  target: number;
  pending: number;
  size: number;
}

interface ThreadWorker {
  queue: PQueue;
  inFlight: Set<number>; // dedup/lookup for enqueued+running chapter numbers
  target: number; // latest requested current chapter
}

/**
 * Per-thread dehydration orchestrator. Each thread gets a serial p-queue
 * (concurrency 1); `ensure(N)` enqueues any missing work for the window
 * [N .. N+LOOKAHEAD], the current chapter first (priority). Each job acquires
 * the source (network) if needed — and acquisition auto-triggers that chapter's
 * rewrite (point 6). File chapters skip acquisition (source is bulk-ingested).
 *
 * p-queue has no native per-key queue / dependency DAG / job-lookup-by-key, so
 * `inFlight` provides dedup/lookup and the acquire→rewrite dependency is an
 * intra-job `await` (serial execution orders chapters). Idempotent + resumable:
 * a later `ensure` re-evaluates the window and re-runs incomplete chapters, so
 * interrupt recovery (point 9) reuses the same path as normal activation.
 */
class DehydrateScheduler {
  private workers = new Map<string, ThreadWorker>();

  private workerFor(threadId: string): ThreadWorker {
    let w = this.workers.get(threadId);
    if (!w) {
      w = {
        queue: new PQueue({ concurrency: 1, timeout: JOB_TIMEOUT_MS }),
        inFlight: new Set(),
        target: 1,
      };
      this.workers.set(threadId, w);
    }
    return w;
  }

  /**
   * Ensure the lookahead window [currentN .. currentN+LOOKAHEAD] is processed.
   * Idempotent + dedup'd → safe for Next, TOC jumps far ahead, and recovery.
   */
  ensure(
    threadId: string,
    currentN: number,
    _config?: EntertainmentConfig,
  ): void {
    const w = this.workerFor(threadId);
    const prevTarget = w.target;
    w.target = currentN;
    let enqueued = 0;
    for (let c = currentN; c <= currentN + LOOKAHEAD; c++) {
      if (w.inFlight.has(c)) continue;
      if (!this.needsWork(threadId, c)) continue;
      this.enqueue(threadId, w, c);
      enqueued++;
    }
    logger.debug("ensure lookahead", {
      threadId,
      currentN,
      prevTarget,
      enqueued,
      inFlight: w.inFlight.size,
      queueSize: w.queue.size,
    });
  }

  /** Liveness + target — backs the worker REST API (GET /worker). */
  getInfo(threadId: string): WorkerLiveness {
    const w = this.workers.get(threadId);
    if (!w) return { active: false, target: 0, pending: 0, size: 0 };
    return {
      active: w.queue.pending > 0 || w.queue.size > 0,
      target: w.target,
      pending: w.queue.pending,
      size: w.queue.size,
    };
  }

  // --- internals ---------------------------------------------------------

  private needsWork(threadId: string, c: number): boolean {
    const type = entertainmentService.getNovelType(threadId);
    const source = entertainmentService.getSourceChapter(threadId, c);
    if (!source) return type === "internet"; // file: beyond end → none; internet: acquire
    if (source.status !== "fetched") return type === "internet"; // re-acquire
    const rewrite = entertainmentService.getRewrittenChapter(threadId, c);
    return !rewrite || rewrite.status !== "rewritten"; // need rewrite
  }

  private enqueue(threadId: string, w: ThreadWorker, c: number): void {
    w.inFlight.add(c);
    const priority = LOOKAHEAD - (c - w.target); // current chapter highest
    logger.debug("enqueue chapter job", {
      threadId,
      chapterNumber: c,
      priority,
    });
    w.queue
      .add(() => this.processChapter(threadId, c), {
        priority,
        id: String(c),
      })
      .catch((err) =>
        logger.error("chapter job failed", { threadId, chapterNumber: c, err }),
      )
      .finally(() => w.inFlight.delete(c));
  }

  /** One chapter, serial per thread: acquire 原文 (internet only) → rewrite 重写. */
  private async processChapter(threadId: string, c: number): Promise<void> {
    const type = entertainmentService.getNovelType(threadId);
    logger.info("processing chapter", { threadId, chapterNumber: c, type });

    // 1) Acquire 原文. Internet: fetch on demand (stub). File: already ingested
    //    as 'fetched' — if no row, the chapter is beyond the file end (skip).
    const source = entertainmentService.getSourceChapter(threadId, c);
    if (!source || source.status !== "fetched") {
      if (type !== "internet") {
        logger.debug("skip acquire — no source row (file end)", {
          threadId,
          chapterNumber: c,
        });
        return; // file: nothing to acquire
      }
      logger.info("acquiring source", { threadId, chapterNumber: c });
      if (!source) {
        entertainmentService.insertSourceChapter({
          threadId,
          chapterNumber: c,
          status: "fetching",
        });
      }
      const text = await acquireSourceStub(c);
      entertainmentService.updateSourceChapter(threadId, c, {
        status: "fetched",
        content: text,
      });
      logger.info("source acquired", {
        threadId,
        chapterNumber: c,
        contentLen: text.length,
      });
    }

    // 2) Rewrite — auto-triggered by source-fill (point 6).
    const rewrite = entertainmentService.getRewrittenChapter(threadId, c);
    if (!rewrite || rewrite.status !== "rewritten") {
      logger.info("rewriting", { threadId, chapterNumber: c });
      if (!rewrite) {
        entertainmentService.insertRewrittenChapter({
          threadId,
          chapterNumber: c,
          status: "rewriting",
        });
      }
      const src = entertainmentService.getSourceChapter(threadId, c);
      const rewritten = await rewriteStub(src?.content ?? "");
      entertainmentService.updateRewrittenChapter(threadId, c, {
        status: "rewritten",
        content: rewritten,
      });
      entertainmentService.touchThread(threadId);
      logger.info("chapter rewritten", {
        threadId,
        chapterNumber: c,
        contentLen: rewritten.length,
      });
    } else {
      logger.debug("chapter already rewritten", {
        threadId,
        chapterNumber: c,
      });
    }
  }
}

export const dehydrateScheduler = new DehydrateScheduler();

// --- stubs (real network-fetch + rewrite-agent logic land later) -----------

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** STUB network acquisition — garbled CJK filler after a short delay. */
export async function acquireSourceStub(chapterNumber: number): Promise<string> {
  await delay(STUB_DELAY_MS);
  const filler = "网络获取的原始章节内容（stub 占位）".repeat(3);
  return `第${chapterNumber}章 · 原文\n\n${filler}\n\n（占位文本；实际网络获取逻辑待实现。）`;
}

// CJK filler sentences cycled so each generated paragraph reads a little
// differently. Throwaway — only used to give the reader long prose to scroll
// and page through until the real rewrite agent lands.
const REWRITE_FILLER_SENTENCES: readonly string[] = [
  "山间的薄雾尚未散去，露珠挂在草叶上，映着初升的日光，闪烁着细碎的光。",
  "少年握紧了腰间那柄尚未开锋的剑，沿着山道一路向东走去，风从谷底升起，吹动他的衣袂。",
  "酒旗在风中猎猎作响，野店里烟气混着酒香，几个行脚商低声说着青锋山庄与那把剑的传说。",
  "师父临终前的话又在耳边响起——剑是用来守护的，不是用来逞强的；江湖很大，大到能让人忘记最初为何出发。",
  "演武场上钟声悠长，黑袍老者周身寒意森然，白衣女子剑法轻灵，号称一剑光寒，令人不敢逼视。",
  "他把这句话记在心里，深吸一口气，踏入了那扇沉重的朱漆大门，前路漫漫，恩怨未明。",
];

/**
 * Builds a long, multi-section markdown body so the reader has plenty of prose
 * to scroll / page through. Stub-only — the real rewrite agent replaces this.
 * The generated length is intentionally "very long" (many screens) so the
 * reader's scroll + page-down behaviour is easy to exercise during development.
 */
function buildLongRewriteStub(sourceText: string): string {
  const lead = `${(sourceText.trim().slice(0, 48) || "（占位原文）")}…`;
  const lines: string[] = [
    "> ▸ 重写版（stub · 长文本用于阅读器滚动 / 翻页测试）",
    "",
    lead,
    "",
  ];
  const sections = 14;
  const parasPerSection = 6;
  for (let s = 1; s <= sections; s++) {
    lines.push(`## 第 ${s} 节 阅读器滚动测试段落 ${s}`);
    for (let p = 0; p < parasPerSection; p++) {
      const idx = (s * 5 + p * 2) % REWRITE_FILLER_SENTENCES.length;
      const sentence = REWRITE_FILLER_SENTENCES[idx];
      // Repeat the sentence a few times so each paragraph is a hefty block.
      lines.push(`（第 ${s} 节 · 第 ${p + 1} 段）${sentence}${sentence}${sentence}`);
    }
  }
  lines.push("", "（占位长文本结束；实际重写 agent 待实现。）");
  return lines.join("\n\n");
}

/** STUB rewrite — long garbled/transformed text after a short delay. */
export async function rewriteStub(sourceText: string): Promise<string> {
  await delay(STUB_DELAY_MS);
  return buildLongRewriteStub(sourceText);
}
