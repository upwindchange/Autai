import log from "electron-log/main";
import { getDb } from "@/db";
import {
  sourceChapters,
  rewrittenChapters,
  entertainmentConfigs,
  threads,
} from "@/db/schema";
import type { RewrittenChapterStatus, SourceChapterStatus } from "@shared";
import { and, eq, sql } from "drizzle-orm";
import { eventBus } from "@/utils/eventBus";

/** SQLite "now" expression for every `updatedAt` write in this service. */
const NOW = sql`(datetime('now'))`;

const logger = log.scope("EntertainmentBackend");
/**
 * Entertainment backend persistence — the DB CRUD layer the entertainment
 * chapter tables write through. Pure writes + the write-side readers
 * (raw novel text, consumed offset, output numbering, final-chapter, thread
 * "touch"). Holds NO reader/REST logic: the reader's merged view and the REST
 * surface live in `frontendService`. Mirrors the CRUD style of
 * `threadPersistenceService`.
 */
class EntertainmentBackendService {
  // --- source chapters (原文) — writes ------------------------------------

  /** Insert a source row (caller ensures it doesn't exist yet). */
  insertSourceChapter(input: {
    threadId: string;
    chapterNumber: number;
    title?: string | null;
    content?: string | null;
    url?: string | null;
    status: SourceChapterStatus;
  }): void {
    const db = getDb();
    db.insert(sourceChapters)
      .values({
        id: crypto.randomUUID(),
        threadId: input.threadId,
        chapterNumber: input.chapterNumber,
        title: input.title ?? null,
        content: input.content ?? null,
        ...(input.url != null && { url: input.url }),
        status: input.status,
      })
      .run();
    eventBus.emitEvent("entertainment:chaptersChanged", {
      threadId: input.threadId,
    });
  }
  /**
   * Own a source row's transition into `"fetching"`: insert a fresh row, or
   * reset a stale one (crash mid-fetch / previous error / re-run). The single
   * upsert every fetcher goes through.
   */
  markSourceChapterFetching(input: {
    threadId: string;
    chapterNumber: number;
  }): void {
    const db = getDb();
    db.insert(sourceChapters)
      .values({
        id: crypto.randomUUID(),
        threadId: input.threadId,
        chapterNumber: input.chapterNumber,
        status: "fetching",
      })
      .onConflictDoUpdate({
        target: [sourceChapters.threadId, sourceChapters.chapterNumber],
        set: {
          status: "fetching",
          updatedAt: NOW,
        },
      })
      .run();
    eventBus.emitEvent("entertainment:chaptersChanged", {
      threadId: input.threadId,
    });
  }

  /** Patch a source row's mutable columns. */
  updateSourceChapter(
    threadId: string,
    chapterNumber: number,
    patch: {
      status?: SourceChapterStatus;
      content?: string | null;
      title?: string | null;
      url?: string | null;
    },
  ): void {
    const db = getDb();
    db.update(sourceChapters)
      .set({ ...patch, updatedAt: NOW })
      .where(
        and(
          eq(sourceChapters.threadId, threadId),
          eq(sourceChapters.chapterNumber, chapterNumber),
        ),
      )
      .run();
    eventBus.emitEvent("entertainment:chaptersChanged", { threadId });
  }
  /**
   * Delete a source row by (threadId, chapterNumber). Idempotent. NOTE:
   * rewritten_chapters has no source-chapter FK, so this does NOT cascade —
   * callers manage the rewrite row separately when they need to.
   */
  deleteSourceChapter(threadId: string, chapterNumber: number): void {
    const db = getDb();
    db.delete(sourceChapters)
      .where(
        and(
          eq(sourceChapters.threadId, threadId),
          eq(sourceChapters.chapterNumber, chapterNumber),
        ),
      )
      .run();
    eventBus.emitEvent("entertainment:chaptersChanged", { threadId });
  }

  // --- rewritten chapters (重写) — writes ---------------------------------

  /**
   * Insert a rewrite row (caller ensures it doesn't exist yet).
   * `chapterNumber` is the reader spine key — for chaptered sources it mirrors
   * the source chapter's number (1:1).
   */
  insertRewrittenChapter(input: {
    threadId: string;
    chapterNumber: number;
    content?: string | null;
    status: RewrittenChapterStatus;
  }): void {
    const db = getDb();
    db.insert(rewrittenChapters)
      .values({
        id: crypto.randomUUID(),
        threadId: input.threadId,
        chapterNumber: input.chapterNumber,
        content: input.content ?? null,
        status: input.status,
      })
      .run();
    eventBus.emitEvent("entertainment:chaptersChanged", {
      threadId: input.threadId,
    });
  }

  /**
   * Own a rewrite row's transition into `"rewriting"`: insert a fresh row, or
   * reset a stale one (previous error / re-run). The single upsert the
   * rewriter goes through.
   */
  markRewrittenChapterRewriting(input: {
    threadId: string;
    chapterNumber: number;
  }): void {
    const db = getDb();
    db.insert(rewrittenChapters)
      .values({
        id: crypto.randomUUID(),
        threadId: input.threadId,
        chapterNumber: input.chapterNumber,
        status: "rewriting",
      })
      .onConflictDoUpdate({
        target: [rewrittenChapters.threadId, rewrittenChapters.chapterNumber],
        set: {
          status: "rewriting",
          updatedAt: NOW,
        },
      })
      .run();
    eventBus.emitEvent("entertainment:chaptersChanged", {
      threadId: input.threadId,
    });
  }

  /** Patch a rewrite row's mutable columns. */
  updateRewrittenChapter(
    threadId: string,
    chapterNumber: number,
    patch: {
      status?: RewrittenChapterStatus;
      content?: string | null;
    },
  ): void {
    const db = getDb();
    db.update(rewrittenChapters)
      .set({ ...patch, updatedAt: NOW })
      .where(
        and(
          eq(rewrittenChapters.threadId, threadId),
          eq(rewrittenChapters.chapterNumber, chapterNumber),
        ),
      )
      .run();
    eventBus.emitEvent("entertainment:chaptersChanged", { threadId });
  }

  // --- dehydrate pass atomic flush ----------------------------------------

  /**
   * Atomic flush of a dehydrate pass's output: inserts the staged chapters
   * (rewrite + source rows for each), advances rawConsumedOffset, optionally
   * sets finalChapterNumber, and touches the thread — all in one transaction.
   * Emits exactly one `entertainment:chaptersChanged` event after commit.
   * Caller supplies already-numbered rows; this does NOT renumber.
   *
   * `replaceAtChapterNumber` (when set) means the FIRST row in `chapters[]`
   * lands on an EXISTING row (the prior pass's `to_be_continued` chapter, whose
   * content was prepended as a lead-in to this pass's chunk). That first row is
   * applied via UPDATE instead of INSERT; subsequent rows insert as normal.
   */
  flushDehydratePass(input: {
    threadId: string;
    chapters: {
      chapterNumber: number;
      title: string;
      content: string;
      rewriteStatus: RewrittenChapterStatus;
    }[];
    newOffset: number;
    finalChapterNumber?: number;
    replaceAtChapterNumber?: number;
  }): void {
    const db = getDb();
    db.transaction((tx) => {
      for (let i = 0; i < input.chapters.length; i++) {
        const ch = input.chapters[i];
        const isReplaceRow =
          input.replaceAtChapterNumber != null &&
          ch.chapterNumber === input.replaceAtChapterNumber;
        if (isReplaceRow) {
          // Lead-in continuation: UPDATE the existing to_be_continued row.
          tx.update(rewrittenChapters)
            .set({
              content: ch.content,
              status: ch.rewriteStatus,
              updatedAt: NOW,
            })
            .where(
              and(
                eq(rewrittenChapters.threadId, input.threadId),
                eq(rewrittenChapters.chapterNumber, ch.chapterNumber),
              ),
            )
            .run();
          tx.update(sourceChapters)
            .set({
              title: ch.title,
              updatedAt: NOW,
            })
            .where(
              and(
                eq(sourceChapters.threadId, input.threadId),
                eq(sourceChapters.chapterNumber, ch.chapterNumber),
              ),
            )
            .run();
        } else {
          tx.insert(rewrittenChapters)
            .values({
              id: crypto.randomUUID(),
              threadId: input.threadId,
              chapterNumber: ch.chapterNumber,
              content: ch.content,
              status: ch.rewriteStatus,
            })
            .run();
          tx.insert(sourceChapters)
            .values({
              id: crypto.randomUUID(),
              threadId: input.threadId,
              chapterNumber: ch.chapterNumber,
              title: ch.title,
              status: "fetched",
            })
            .run();
        }
      }
      tx.update(entertainmentConfigs)
        .set({
          rawConsumedOffset: input.newOffset,
          ...(input.finalChapterNumber != null && {
            finalChapterNumber: input.finalChapterNumber,
          }),
          updatedAt: NOW,
        })
        .where(eq(entertainmentConfigs.threadId, input.threadId))
        .run();
      tx.update(threads)
        .set({ updatedAt: NOW })
        .where(eq(threads.id, input.threadId))
        .run();
    });
    eventBus.emitEvent("entertainment:chaptersChanged", {
      threadId: input.threadId,
    });
  }

  // --- internet dead-site blocklist ----------------------------------------

  /**
   * Read the thread's persistent dead-site blocklist: hostname → reason the
   * site was judged dead (paywall / captcha / wrong-content / …). Stored as
   * JSON in `entertainment_configs.blocked_sites`; never throws — malformed
   * stored JSON yields an empty record.
   */
  getBlockedSites(threadId: string): Record<string, string> {
    const db = getDb();
    const row = db
      .select({ blockedSites: entertainmentConfigs.blockedSites })
      .from(entertainmentConfigs)
      .where(eq(entertainmentConfigs.threadId, threadId))
      .get();
    if (!row?.blockedSites) return {};
    try {
      const parsed: unknown = JSON.parse(row.blockedSites);
      if (
        parsed &&
        typeof parsed === "object" &&
        Object.values(parsed).every((v) => typeof v === "string")
      ) {
        return parsed as Record<string, string>;
      }
      return {};
    } catch {
      return {};
    }
  }

  /**
   * Mark a hostname dead for the thread with a reason. Idempotent merge into
   * the stored JSON (the FIRST reason a site earns is kept — it is the most
   * specific diagnosis).
   */
  blockSite(threadId: string, hostname: string, reason: string): void {
    const blocked = this.getBlockedSites(threadId);
    if (hostname in blocked) return;
    blocked[hostname] = reason;
    const db = getDb();
    db.update(entertainmentConfigs)
      .set({ blockedSites: JSON.stringify(blocked), updatedAt: NOW })
      .where(eq(entertainmentConfigs.threadId, threadId))
      .run();
    logger.info("site blocked for thread", { threadId, hostname, reason });
  }

  /**
   * Reset the blocklist (called when the crawl tab is released at book end,
   * or on an explicit user reset so a site can be re-probed).
   */
  clearBlockedSites(threadId: string): void {
    const db = getDb();
    db.update(entertainmentConfigs)
      .set({ blockedSites: null, updatedAt: NOW })
      .where(eq(entertainmentConfigs.threadId, threadId))
      .run();
  }


  /**
   * Demote every in-progress status left over from a previous process that
   * died mid-run (power loss, crash, force-quit): `fetching` sources and
   * `rewriting` rewrites become `error`. No runner survives a process exit,
   * so such rows are permanently frozen otherwise — they'd spin the UI as
   * "fetching/rewriting" forever and `retryFailed` (which collects only
   * `error`) would never pick them up. As `error` they are ordinary retryable
   * rows: the reader's 重试 button, footer reprocess, and resume paths all
   * handle them; refetch/refine resets the status before running.
   *
   * One global sweep at startup, BEFORE any scheduler runs (main index calls
   * this right after DB init). Per-row updates keep it simple — the counts
   * are tiny (at most one frozen chapter per thread), and a bulk UPDATE ...
   * RETURNING would complicate the per-thread event emission for no gain.
   */
  sweepStaleInProgress(): void {
    const db = getDb();
    let swept = 0;
    for (const [table, staleStatus] of [
      [sourceChapters, "fetching"],
      [rewrittenChapters, "rewriting"],
    ] as const) {
      const stale = db
        .select({
          threadId: table.threadId,
          chapterNumber: table.chapterNumber,
        })
        .from(table)
        .where(eq(table.status, staleStatus))
        .all();
      for (const row of stale) {
        db.update(table)
          .set({ status: "error", updatedAt: NOW })
          .where(
            and(
              eq(table.threadId, row.threadId),
              eq(table.chapterNumber, row.chapterNumber),
            ),
          )
          .run();
        eventBus.emitEvent("entertainment:chaptersChanged", {
          threadId: row.threadId,
        });
      }
      swept += stale.length;
    }
    if (swept > 0) {
      logger.info("swept stale in-progress rows", { swept });
    }
  }

  // --- output numbering ---------------------------------------------------

  /**
   * Highest rewrite OUTPUT sequential number for the thread, or 0 if none.
   */
  maxRewrittenChapterNumber(threadId: string): number {
    const db = getDb();
    const row = db
      .select({
        max: sql<number>`cast(max(${rewrittenChapters.chapterNumber}) as integer)`,
      })
      .from(rewrittenChapters)
      .where(eq(rewrittenChapters.threadId, threadId))
      .get();
    return row?.max ?? 0;
  }

  /** The persisted raw novel text (null if none / already cleared). */
  getRawNovelText(threadId: string): string | null {
    const db = getDb();
    const row = db
      .select({ rawText: entertainmentConfigs.rawText })
      .from(entertainmentConfigs)
      .where(eq(entertainmentConfigs.threadId, threadId))
      .get();
    return row?.rawText ?? null;
  }

  /** Persist the decoded raw novel text (called once at upload). */
  setRawNovelText(threadId: string, rawText: string): void {
    const db = getDb();
    db.update(entertainmentConfigs)
      .set({
        rawText,
        rawConsumedOffset: 0,
        updatedAt: NOW,
      })
      .where(eq(entertainmentConfigs.threadId, threadId))
      .run();
  }

  clearRawNovelText(threadId: string): void {
    const db = getDb();
    db.update(entertainmentConfigs)
      .set({
        rawText: null,
        updatedAt: NOW,
      })
      .where(eq(entertainmentConfigs.threadId, threadId))
      .run();
  }

  getConsumedOffset(threadId: string): number {
    const db = getDb();
    const row = db
      .select({
        rawConsumedOffset: entertainmentConfigs.rawConsumedOffset,
      })
      .from(entertainmentConfigs)
      .where(eq(entertainmentConfigs.threadId, threadId))
      .get();
    return row?.rawConsumedOffset ?? 0;
  }


  // --- final chapter ------------------------------------------------------

  /** Persist the book's final chapter number. */
  setFinalChapterNumber(threadId: string, chapterNumber: number): void {
    const db = getDb();
    db.update(entertainmentConfigs)
      .set({
        finalChapterNumber: chapterNumber,
        updatedAt: NOW,
      })
      .where(eq(entertainmentConfigs.threadId, threadId))
      .run();
    eventBus.emitEvent("entertainment:chaptersChanged", { threadId });
  }

  // --- thread touch -------------------------------------------------------

  /** Bump `threads.updatedAt` so the thread floats to the top of the sidebar. */
  touchThread(threadId: string): void {
    const db = getDb();
    db.update(threads)
      .set({ updatedAt: NOW })
      .where(eq(threads.id, threadId))
      .run();
  }
  // --- scheduler queries --------------------------------------------------

  /**
   * Count rewrite OUTPUT rows for the thread. The scheduler uses this to tell
   * a done thread from a not-yet-started one (zero rewrites ⇒ user never
   * pressed Start ⇒ don't auto-run rewrite on open).
   */
  countRewrittenChapters(threadId: string): number {
    const db = getDb();
    const row = db
      .select({
        count: sql<number>`cast(count(*) as integer)`,
      })
      .from(rewrittenChapters)
      .where(eq(rewrittenChapters.threadId, threadId))
      .get();
    return row?.count ?? 0;
  }
}

export const entertainmentBackendService = new EntertainmentBackendService();
