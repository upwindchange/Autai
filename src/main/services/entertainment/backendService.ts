import { getDb } from "@/db";
import {
  sourceChapters,
  rewrittenChapters,
  entertainmentConfigs,
  threads,
} from "@/db/schema";
import type {
  RewrittenChapterStatus,
  SourceChapterStatus,
} from "@shared";
import { and, eq, sql } from "drizzle-orm";

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
      .set({ ...patch, updatedAt: sql`(datetime('now'))` })
      .where(
        and(
          eq(sourceChapters.threadId, threadId),
          eq(sourceChapters.chapterNumber, chapterNumber),
        ),
      )
      .run();
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
      .set({ ...patch, updatedAt: sql`(datetime('now'))` })
      .where(
        and(
          eq(rewrittenChapters.threadId, threadId),
          eq(rewrittenChapters.chapterNumber, chapterNumber),
        ),
      )
      .run();
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
        updatedAt: sql`(datetime('now'))`,
      })
      .where(eq(entertainmentConfigs.threadId, threadId))
      .run();
  }

  clearRawNovelText(threadId: string): void {
    const db = getDb();
    db.update(entertainmentConfigs)
      .set({
        rawText: null,
        updatedAt: sql`(datetime('now'))`,
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

  /** Persist the consumed offset. */
  setConsumedOffset(threadId: string, offset: number): void {
    const db = getDb();
    db.update(entertainmentConfigs)
      .set({
        rawConsumedOffset: offset,
        updatedAt: sql`(datetime('now'))`,
      })
      .where(eq(entertainmentConfigs.threadId, threadId))
      .run();
  }

  // --- final chapter ------------------------------------------------------

  /** Persist the book's final chapter number. */
  setFinalChapterNumber(threadId: string, chapterNumber: number): void {
    const db = getDb();
    db.update(entertainmentConfigs)
      .set({
        finalChapterNumber: chapterNumber,
        updatedAt: sql`(datetime('now'))`,
      })
      .where(eq(entertainmentConfigs.threadId, threadId))
      .run();
  }

  // --- thread touch -------------------------------------------------------

  /** Bump `threads.updatedAt` so the thread floats to the top of the sidebar. */
  touchThread(threadId: string): void {
    const db = getDb();
    db.update(threads)
      .set({ updatedAt: sql`(datetime('now'))` })
      .where(eq(threads.id, threadId))
      .run();
  }
}

export const entertainmentBackendService = new EntertainmentBackendService();
