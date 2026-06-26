import { getDb } from "@/db";
import { chapters, entertainmentConfigs, threads } from "@/db/schema";
import type {
  ChapterFull,
  ChapterStatus,
  ChapterSummary,
  EntertainmentConfig,
} from "@shared";
import type { EntertainmentConfigRow } from "@/db/types";
import { threadPersistenceService } from "./threadPersistenceService";
import { i18n } from "@/i18n";
import { eventBus } from "@/utils/eventBus";
import { asc, eq, sql } from "drizzle-orm";
import log from "electron-log/main";

const logger = log.scope("EntertainmentService");

/**
 * Entertainment-mode persistence — a thin DB CRUD layer ONLY. It is the single
 * place the REST routes (and the dehydrate worker) touch the entertainment
 * tables. It holds NO novel/LLM workflow: parsing, ingestion, and generation
 * live in `dehydrate/worker.ts`. Anything that reads or writes chapter/config
 * rows goes through here.
 *
 * Mirrors the CRUD style of `threadPersistenceService` (getDb(), .run()/.all()/
 * .get(), db.transaction).
 */
class EntertainmentService {
  initialize(): void {
    logger.info("EntertainmentService ready");
  }

  // --- chapters -----------------------------------------------------------

  /** Light list (no `content`/`originalContent`) ordered by chapterNumber — for the TOC/reader. */
  listChapters(threadId: string): ChapterSummary[] {
    const db = getDb();
    const rows = db
      .select({
        id: chapters.id,
        chapterNumber: chapters.chapterNumber,
        title: chapters.title,
        status: chapters.status,
      })
      .from(chapters)
      .where(eq(chapters.threadId, threadId))
      .orderBy(asc(chapters.chapterNumber))
      .all();
    return rows;
  }

  /** Single chapter incl. `content` + `originalContent`, scoped to the thread. */
  getChapter(threadId: string, chapterId: string): ChapterFull | undefined {
    const db = getDb();
    const row = db
      .select()
      .from(chapters)
      .where(eq(chapters.id, chapterId))
      .get();
    if (!row || row.threadId !== threadId) return undefined;
    return {
      id: row.id,
      chapterNumber: row.chapterNumber,
      title: row.title,
      status: row.status,
      content: row.content,
      originalContent: row.originalContent,
    };
  }

  /** Insert a chapter row in any status; returns its id/number/title. */
  createChapter(input: {
    threadId: string;
    chapterNumber: number;
    title: string | null;
    status: ChapterStatus;
    content?: string | null;
    originalContent?: string | null;
  }): { id: string; chapterNumber: number; title: string | null } {
    const db = getDb();
    const id = crypto.randomUUID();
    db.insert(chapters)
      .values({
        id,
        threadId: input.threadId,
        chapterNumber: input.chapterNumber,
        title: input.title,
        status: input.status,
        content: input.content ?? null,
        originalContent: input.originalContent ?? null,
      })
      .run();
    const row = db.select().from(chapters).where(eq(chapters.id, id)).get()!;
    return { id: row.id, chapterNumber: row.chapterNumber, title: row.title };
  }

  /** Patch a chapter row's mutable columns (status/content/originalContent/title). */
  updateChapter(
    chapterId: string,
    patch: {
      status?: ChapterStatus;
      content?: string | null;
      originalContent?: string | null;
      title?: string | null;
    },
  ): void {
    const db = getDb();
    db.update(chapters)
      .set({ ...patch, updatedAt: sql`(datetime('now'))` })
      .where(eq(chapters.id, chapterId))
      .run();
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

  upsertEntertainmentConfig(threadId: string, config: EntertainmentConfig): void {
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

  // --- thread setup (metadata only — no generation) -----------------------

  /** 1-based next chapter number for the thread (1 if none yet). */
  nextChapterNumber(threadId: string): number {
    const list = this.listChapters(threadId);
    return list.length === 0 ?
        1
      : list.reduce((max, c) => Math.max(max, c.chapterNumber), 0) + 1;
  }

  /**
   * First-chapter side-effects: a deterministic title + the entertainment tag.
   * Pure metadata (thread rename + tag + `threads:metadataUpdated` event) — no
   * chapter content. Called by the chapter route on the first chapter of a
   * thread.
   */
  setupEntertainmentThread(threadId: string, config: EntertainmentConfig): void {
    const novel = config.novel;
    const modeLabel = i18n.t(`entertainment.${config.mode}`);
    const novelLabel = novel.type === "internet" ? novel.title : novel.filename;
    const isZh = (i18n.language ?? "en").startsWith("zh");
    const title = isZh ?
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
