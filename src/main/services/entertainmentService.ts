import { getDb } from "@/db";
import {
  chapters,
  entertainmentConfigs,
  threads,
} from "@/db/schema";
import type { ChapterFull, ChapterSummary, EntertainmentConfig } from "@shared";
import type { ChapterRow, EntertainmentConfigRow } from "@/db/types";
import { threadPersistenceService } from "./threadPersistenceService";
import { i18n } from "@/i18n";
import { eventBus } from "@/utils/eventBus";
import { asc, eq, sql } from "drizzle-orm";
import log from "electron-log/main";
import { getSampleChapter } from "@agents/workers/entertainmentWorker/sample-novel";

const logger = log.scope("EntertainmentService");

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Entertainment-mode persistence + stub generation.
 *
 * The dehydrate stub's only job (per the design contract) is: store chapters in
 * the DB and fire `entertainment:chapterReady` when one is written. There is NO
 * live streaming — the frontend reads every chapter (including a freshly
 * generated one) from disk, prompted by the ready event.
 *
 * Mirrors the CRUD style of `threadPersistenceService` (getDb(), .run()/.all()/
 * .get(), db.transaction). A chapter is "in progress" while its row has
 * `status = 'streaming'` (the enum predates dropping the stream channel; it now
 * just means "being generated") — that row is the DB-backed source of truth for
 * a thread's "waiting" state, so it survives thread switches / mode exits /
 * reloads.
 */
class EntertainmentService {
  initialize(): void {
    logger.info("EntertainmentService ready");
  }

  // --- chapters -----------------------------------------------------------

  /** Light list (no `content`) ordered by chapterNumber — for the TOC/reader. */
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

  /** Single chapter incl. `content`, scoped to the thread. */
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
    };
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

  // --- generation ---------------------------------------------------------

  /** 1-based next chapter number for the thread (1 if none yet). */
  private nextChapterNumber(threadId: string): number {
    const list = this.listChapters(threadId);
    return list.length === 0 ?
        1
      : list.reduce((max, c) => Math.max(max, c.chapterNumber), 0) + 1;
  }

  /** Insert an in-progress chapter row so the waiting state is visible at once. */
  private createInProgressChapter(
    threadId: string,
    chapterNumber: number,
    title: string | null,
  ): ChapterRow {
    const db = getDb();
    const id = crypto.randomUUID();
    db.insert(chapters)
      .values({
        id,
        threadId,
        chapterNumber,
        title,
        status: "streaming",
        content: null,
      })
      .run();
    return db.select().from(chapters).where(eq(chapters.id, id)).get()!;
  }

  /**
   * First-chapter side-effects: deterministic title + entertainment tag (lifted
   * from the old entertainmentRoutes first-message branch). Called only when no
   * entertainment_configs row exists yet for the thread.
   */
  private applyFirstChapterSideEffects(
    threadId: string,
    config: EntertainmentConfig,
  ): void {
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

  /**
   * Set up a new chapter generation: ensures the thread + config exist, runs
   * first-chapter side-effects on the first chapter, and inserts the in-progress
   * chapter row. Returns the new chapter so the route can answer `202`
   * immediately; the actual (detached) generation is kicked off separately via
   * `generateChapter`.
   */
  beginChapter(
    threadId: string,
    config: EntertainmentConfig | undefined,
  ): { chapterId: string; chapterNumber: number; title: string | null } {
    const db = getDb();

    // Defensive: make sure the thread row exists (covers any thread-
    // materialization timing from assistant-ui).
    if (!threadPersistenceService.getThread(threadId)) {
      threadPersistenceService.createThread(threadId, "entertainment");
    }

    const isFirst = !this.getEntertainmentConfig(threadId);
    if (isFirst) {
      // config is required on the first chapter (the route validates this).
      if (!config) {
        throw new Error("config required for the first chapter");
      }
      this.upsertEntertainmentConfig(threadId, config);
      this.applyFirstChapterSideEffects(threadId, config);
    } else if (config) {
      // Later sends may refresh the config.
      this.upsertEntertainmentConfig(threadId, config);
    }

    const chapterNumber = this.nextChapterNumber(threadId);
    const title = getSampleChapter(chapterNumber).title;
    const row = this.createInProgressChapter(threadId, chapterNumber, title);

    // bump threads.updatedAt so the thread floats to the top of the sidebar.
    db.update(threads)
      .set({ updatedAt: sql`(datetime('now'))` })
      .where(eq(threads.id, threadId))
      .run();

    return { chapterId: row.id, chapterNumber: row.chapterNumber, title };
  }

  /**
   * Stub generation: assemble the sample chapter, simulate work with a small
   * per-paragraph delay (so the "waiting" state is observable), then write the
   * complete row + fire `entertainment:chapterReady`. On abort, mark `error`
   * and still fire the event so the frontend stops waiting. Detached from the
   * HTTP request — must be safe to run after the route has returned `202`.
   */
  async generateChapter(
    threadId: string,
    chapterId: string,
    chapterNumber: number,
    signal?: AbortSignal,
  ): Promise<void> {
    const sample = getSampleChapter(chapterNumber);
    // Simulate generation (observable waiting state); bail early on abort.
    const accumulated: string[] = [];
    for (const paragraph of sample.paragraphs) {
      if (signal?.aborted) break;
      accumulated.push(paragraph);
      await delay(250);
    }

    const db = getDb();
    if (signal?.aborted) {
      db.update(chapters)
        .set({ status: "error", updatedAt: sql`(datetime('now'))` })
        .where(eq(chapters.id, chapterId))
        .run();
      logger.warn("chapter generation aborted", { threadId, chapterId });
    } else {
      db.transaction((tx) => {
        tx.update(chapters)
          .set({
            status: "complete",
            content: accumulated.join("\n\n"),
            updatedAt: sql`(datetime('now'))`,
          })
          .where(eq(chapters.id, chapterId))
          .run();
        tx.update(threads)
          .set({ updatedAt: sql`(datetime('now'))` })
          .where(eq(threads.id, threadId))
          .run();
      });
      logger.info("chapter ready", {
        threadId,
        chapterId,
        chapterNumber,
      });
    }

    eventBus.emitEvent("entertainment:chapterReady", { threadId, chapterId });
  }
}

export const entertainmentService = new EntertainmentService();
