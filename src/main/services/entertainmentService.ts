import { getDb } from "@/db";
import {
  sourceChapters,
  rewrittenChapters,
  entertainmentConfigs,
  threads,
} from "@/db/schema";
import type {
  ChapterDetail,
  ChapterProgress,
  EntertainmentConfig,
  RewrittenChapterStatus,
  SourceChapterStatus,
} from "@shared";
import type { EntertainmentConfigRow } from "@/db/types";
import { threadPersistenceService } from "./threadPersistenceService";
import { i18n } from "@/i18n";
import { eventBus } from "@/utils/eventBus";
import { and, asc, eq, sql } from "drizzle-orm";
import log from "electron-log/main";

const logger = log.scope("EntertainmentService");

/**
 * Entertainment-mode persistence — a thin DB CRUD layer ONLY. It is the single
 * place the REST routes (and the dehydrate scheduler) touch the entertainment
 * tables. It holds NO novel/LLM workflow: encoding/ingestion, the lookahead
 * queue, acquisition, and rewriting live in the dehydrate scheduler/ingest
 * modules. Anything that reads or writes chapter/config rows goes through here.
 *
 * Chapters span TWO tables — `sourceChapters` (原文) and `rewrittenChapters`
 * (重写) — merged by chapterNumber for the reader's view (`listChapterProgress`
 * / `getChapterDetail`). Mirrors the CRUD style of `threadPersistenceService`.
 */
class EntertainmentService {
  initialize(): void {
    logger.info("EntertainmentService ready");
  }

  // --- source chapters (原文) ---------------------------------------------

  /** All source rows for the thread, ordered by chapterNumber. */
  listSourceChapters(threadId: string) {
    const db = getDb();
    return db
      .select()
      .from(sourceChapters)
      .where(eq(sourceChapters.threadId, threadId))
      .orderBy(asc(sourceChapters.chapterNumber))
      .all();
  }

  /** Source row by chapter number (undefined if none). */
  getSourceChapter(threadId: string, chapterNumber: number) {
    const db = getDb();
    return db
      .select()
      .from(sourceChapters)
      .where(
        and(
          eq(sourceChapters.threadId, threadId),
          eq(sourceChapters.chapterNumber, chapterNumber),
        ),
      )
      .get();
  }

  /** Insert a source row (caller ensures it doesn't exist yet). */
  insertSourceChapter(input: {
    threadId: string;
    chapterNumber: number;
    title?: string | null;
    content?: string | null;
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

  // --- rewritten chapters (重写) ------------------------------------------

  /** Rewrite row by chapter number (undefined if none). */
  getRewrittenChapter(threadId: string, chapterNumber: number) {
    const db = getDb();
    return db
      .select()
      .from(rewrittenChapters)
      .where(
        and(
          eq(rewrittenChapters.threadId, threadId),
          eq(rewrittenChapters.chapterNumber, chapterNumber),
        ),
      )
      .get();
  }

  /** Insert a rewrite row (caller ensures it doesn't exist yet). */
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

  // --- merged reader view -------------------------------------------------

  /** Per-chapter pipeline progress (source + rewrite merged), ordered. */
  listChapterProgress(threadId: string): ChapterProgress[] {
    const sources = this.listSourceChapters(threadId);
    const db = getDb();
    const rewrites = db
      .select()
      .from(rewrittenChapters)
      .where(eq(rewrittenChapters.threadId, threadId))
      .all();
    const rewriteByNum = new Map(rewrites.map((r) => [r.chapterNumber, r]));
    return sources.map((s) => ({
      chapterNumber: s.chapterNumber,
      title: s.title,
      sourceStatus: s.status,
      rewriteStatus: rewriteByNum.get(s.chapterNumber)?.status ?? null,
    }));
  }

  /** Single-chapter detail (synthesizes null statuses if no rows yet). */
  getChapterDetail(threadId: string, chapterNumber: number): ChapterDetail {
    const s = this.getSourceChapter(threadId, chapterNumber);
    const r = this.getRewrittenChapter(threadId, chapterNumber);
    return {
      chapterNumber,
      title: s?.title ?? null,
      sourceStatus: s?.status ?? null,
      rewriteStatus: r?.status ?? null,
      // Only expose rewritten prose to the reader (never 原文).
      content: r?.status === "rewritten" ? r.content : null,
    };
  }

  /** Bump `threads.updatedAt` so the thread floats to the top of the sidebar. */
  touchThread(threadId: string): void {
    const db = getDb();
    db.update(threads)
      .set({ updatedAt: sql`(datetime('now'))` })
      .where(eq(threads.id, threadId))
      .run();
  }

  // --- config -------------------------------------------------------------

  getEntertainmentConfig(threadId: string): EntertainmentConfigRow | undefined {
    const db = getDb();
    return db
      .select()
      .from(entertainmentConfigs)
      .where(eq(entertainmentConfigs.threadId, threadId))
      .get();
  }

  upsertEntertainmentConfig(
    threadId: string,
    config: EntertainmentConfig,
  ): void {
    const db = getDb();
    db.insert(entertainmentConfigs)
      .values({
        threadId,
        mode: config.mode,
        options: JSON.stringify(config.options),
        // novelSource = the wizard's origin pointer (file path / URL / guidance),
        // NOT the content. Nullable/mutable because input is dynamic.
        novelSource: JSON.stringify(config.novel),
      })
      .onConflictDoUpdate({
        target: entertainmentConfigs.threadId,
        set: {
          mode: config.mode,
          options: JSON.stringify(config.options),
          novelSource: JSON.stringify(config.novel),
          updatedAt: sql`(datetime('now'))`,
        },
      })
      .run();
  }

  /** Last-read chapter for interrupt recovery (null if never read). */
  getLastChapterNumber(threadId: string): number | null {
    return this.getEntertainmentConfig(threadId)?.lastChapterNumber ?? null;
  }

  /** Persist the reader's current chapter for resume-on-reopen. */
  setLastChapterNumber(threadId: string, chapterNumber: number): void {
    const db = getDb();
    db.update(entertainmentConfigs)
      .set({
        lastChapterNumber: chapterNumber,
        updatedAt: sql`(datetime('now'))`,
      })
      .where(eq(entertainmentConfigs.threadId, threadId))
      .run();
  }

  /** Novel source type from the stored config — drives file-vs-internet behavior. */
  getNovelType(threadId: string): "file" | "internet" | null {
    const row = this.getEntertainmentConfig(threadId);
    if (!row?.novelSource) return null;
    try {
      const novel = JSON.parse(row.novelSource) as { type?: string };
      return novel.type === "file" || novel.type === "internet" ?
          novel.type
        : null;
    } catch {
      return null;
    }
  }

  // --- thread setup (metadata only — no generation) -----------------------

  /**
   * First-chapter side-effects: a deterministic title + the entertainment tag.
   * Pure metadata (thread rename + tag + `threads:metadataUpdated` event) — no
   * chapter content. Called by the chapter route on the first chapter of a
   * thread.
   */
  setupEntertainmentThread(
    threadId: string,
    config: EntertainmentConfig,
  ): void {
    const novel = config.novel;
    const modeLabel = i18n.t(`entertainment.${config.mode}`);
    const novelLabel = novel.type === "internet" ? novel.title : novel.filename;
    const isZh = (i18n.language ?? "en").startsWith("zh");
    const title =
      isZh ?
        `《${novelLabel}》 — ${modeLabel}`
      : `${novelLabel} — ${modeLabel}`;
    threadPersistenceService.renameThread(threadId, title);

    let tag = threadPersistenceService
      .listTagsByMode("entertainment")
      .find((t) => t.name === modeLabel);
    if (!tag) {
      tag = threadPersistenceService.createTag(
        modeLabel,
        config.mode === "dehydrate" ? "#F28E2B" : "#E15759",
        0,
        "entertainment",
      );
    }
    threadPersistenceService.addTagToThread(threadId, tag.id);

    logger.info("Set deterministic entertainment title + tag", {
      threadId,
      title,
      tag: tag.name,
    });
    eventBus.emitEvent("threads:metadataUpdated", {
      threadId,
      title,
      tags: [{ ...tag, color: tag.color ?? "" }],
    });
  }
}

export const entertainmentService = new EntertainmentService();
