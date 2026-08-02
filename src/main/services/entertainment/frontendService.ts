import { getDb } from "@/db";
import {
  bookmarks,
  sourceChapters,
  rewrittenChapters,
  entertainmentConfigs,
} from "@/db/schema";
import type {
  Bookmark,
  BookmarkAnchor,
  ChapterDetail,
  ChapterProgress,
  EntertainmentConfig,
} from "@shared";
import { EntertainmentConfigSchema } from "@shared";
import type { EntertainmentConfigRow } from "@/db/types";
import { threadPersistenceService } from "../threadPersistenceService";
import { i18n } from "@/i18n";
import { eventBus } from "@/utils/eventBus";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import log from "electron-log/main";

const logger = log.scope("EntertainmentFrontend");

/**
 * Entertainment frontend persistence — the DB CRUD layer the REST routes
 * (`entertainmentRoutes.ts`) read/write through: the wizard's config, the
 * reader's merged chapter view, read-position, export, and bookmarks.
 *
 * Chapters span TWO tables — `sourceChapters` (原文) and `rewrittenChapters`
 * (重写) — merged by chapterNumber for the reader's view
 * (`listChapterProgress` / `getChapterDetail`).
 */
class EntertainmentFrontendService {
  initialize(): void {
    logger.info("EntertainmentFrontendService ready");
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

  /**
   * Reconstruct + re-validate the stored config into a typed
   * `EntertainmentConfig`. Callers use this to feed the real, persisted wizard
   * values (novel origin + options) to the acquisition/rewrite modules.
   * Re-validation via `EntertainmentConfigSchema.safeParse` is defensive
   * against malformed stored JSON and also heals older configs that predate
   * newer `.default(...)` fields (e.g. `customInstruction`) — no migration
   * needed. Returns null (never throws) when the row or its JSON is unusable,
   * mirroring `getNovelType`'s contract.
   */
  getParsedConfig(threadId: string): EntertainmentConfig | null {
    const row = this.getEntertainmentConfig(threadId);
    if (!row?.novelSource || !row.options) return null;
    try {
      const raw = {
        mode: row.mode,
        novel: JSON.parse(row.novelSource),
        options: JSON.parse(row.options),
      };
      const parsed = EntertainmentConfigSchema.safeParse(raw);
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
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

  // --- chapter reads (原文 / 重写 rows) -----------------------------------

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

  /**
   * All rewrite OUTPUT rows for the thread, ordered by `chapterNumber` (the
   * reader's spine key). Used by the read-side spine
   * (`listChapterProgress`/`getChapterDetail`).
   */
  listRewrittenChapters(threadId: string) {
    const db = getDb();
    return db
      .select()
      .from(rewrittenChapters)
      .where(eq(rewrittenChapters.threadId, threadId))
      .orderBy(asc(rewrittenChapters.chapterNumber))
      .all();
  }

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

  // --- merged reader view -------------------------------------------------
  // The reader's SPINE is `rewritten_chapters`. Each rewrite row joins its
  // source row directly — title + sourceStatus come from the source row at the
  // same number. Source chapters with no rewrite row yet are NOT shown (the
  // reader never renders 原文); a not-yet-rewritten chapter shows as `stopped`.

  /**
   * Per-chapter progress, spine'd on `rewritten_chapters`. title/sourceStatus
   * come from the source row at the same chapterNumber.
   */
  listChapterProgress(threadId: string): ChapterProgress[] {
    const outputs = this.listRewrittenChapters(threadId);
    if (outputs.length === 0) return [];
    const sourceByNum = new Map(
      this.listSourceChapters(threadId).map((s) => [s.chapterNumber, s]),
    );
    return outputs.map((r) => {
      const s = sourceByNum.get(r.chapterNumber);
      return {
        chapterNumber: r.chapterNumber,
        title: s?.title ?? null,
        sourceStatus: s?.status ?? null,
        rewriteStatus: r.status,
      };
    });
  }

  /**
   * Single-chapter detail (1:1 keyed). Prose comes from the rewrite row (only
   * when `rewritten`); title/sourceStatus from the source row at the same
   * number.
   */
  getChapterDetail(threadId: string, chapterNumber: number): ChapterDetail {
    const r = this.getRewrittenChapter(threadId, chapterNumber);
    if (!r) {
      // No rewrite row yet — synthesize null statuses so the reader's phase
      // derivation renders `stopped`/`paused` rather than erroring.
      return {
        chapterNumber,
        title: null,
        sourceStatus: null,
        rewriteStatus: null,
        content: null,
      };
    }
    const s = this.getSourceChapter(threadId, chapterNumber);
    return {
      chapterNumber: r.chapterNumber,
      title: s?.title ?? null,
      sourceStatus: s?.status ?? null,
      rewriteStatus: r.status,
      // Only expose rewritten prose to the reader (never 原文).
      content: r.status === "rewritten" ? r.content : null,
    };
  }

  /**
   * Rewritten chapters in [from, to] (either bound optional), ordered asc — the
   * export/download source. Only `rewritten` rows (with prose); title from the
   * source row at the same chapterNumber.
   */
  listExportChapters(
    threadId: string,
    range: { from?: number; to?: number },
  ): { chapterNumber: number; title: string | null; content: string }[] {
    const db = getDb();
    const rewrites = db
      .select()
      .from(rewrittenChapters)
      .where(
        and(
          eq(rewrittenChapters.threadId, threadId),
          eq(rewrittenChapters.status, "rewritten"),
        ),
      )
      .orderBy(asc(rewrittenChapters.chapterNumber))
      .all();
    const sourceByNum = new Map(
      this.listSourceChapters(threadId).map((s) => [s.chapterNumber, s]),
    );
    const out: {
      chapterNumber: number;
      title: string | null;
      content: string;
    }[] = [];
    for (const r of rewrites) {
      if (range.from != null && r.chapterNumber < range.from) continue;
      if (range.to != null && r.chapterNumber > range.to) continue;
      out.push({
        chapterNumber: r.chapterNumber,
        title: sourceByNum.get(r.chapterNumber)?.title ?? null,
        content: r.content ?? "",
      });
    }
    return out;
  }

  // --- bookmarks ----------------------------------------------------------

  /**
   * All bookmarks for the thread, newest first, with `chapterNumber` + `title`
   * joined from the rewrite row + its 1:1 source row (title from source).
   */
  listBookmarks(threadId: string): Bookmark[] {
    const db = getDb();
    const rows = db
      .select()
      .from(bookmarks)
      .where(eq(bookmarks.threadId, threadId))
      .orderBy(desc(bookmarks.createdAt))
      .all();
    if (rows.length === 0) return [];
    const rewriteById = new Map(
      db
        .select()
        .from(rewrittenChapters)
        .where(eq(rewrittenChapters.threadId, threadId))
        .all()
        .map((r) => [r.id, r]),
    );
    const sourceByNum = new Map(
      this.listSourceChapters(threadId).map((s) => [s.chapterNumber, s]),
    );
    const out: Bookmark[] = [];
    for (const row of rows) {
      const rewrite = rewriteById.get(row.chapterId);
      if (!rewrite) continue; // orphaned (cascade makes impossible)
      out.push(
        this.mapBookmark(
          row,
          rewrite.chapterNumber,
          sourceByNum.get(rewrite.chapterNumber)?.title ?? null,
        ),
      );
    }
    return out;
  }

  /**
   * Save a reading spot. `chapterId` is resolved from (threadId, chapterNumber);
   * throws if no rewrite row exists yet (the reader only bookmarks ready
   * chapters, so this is defensive). Title from the source row at the same
   * number. `label`/`note` left null (auto-label is rendered client-side).
   */
  createBookmark(
    threadId: string,
    chapterNumber: number,
    anchor?: BookmarkAnchor | null,
    label?: string | null,
    note?: string | null,
  ): Bookmark {
    const rewrite = this.getRewrittenChapter(threadId, chapterNumber);
    if (!rewrite) {
      throw new Error(
        `No rewritten chapter ${chapterNumber} for thread ${threadId}`,
      );
    }
    const db = getDb();
    const id = crypto.randomUUID();
    db.insert(bookmarks)
      .values({
        id,
        threadId,
        chapterId: rewrite.id,
        anchor: anchor ? JSON.stringify(anchor) : null,
        label: label ?? null,
        note: note ?? null,
      })
      .run();
    // Re-read to pick up the DB-generated createdAt (consistent with listBookmarks).
    const row = db.select().from(bookmarks).where(eq(bookmarks.id, id)).get();
    if (!row) throw new Error(`Bookmark ${id} vanished after insert`);
    const title = this.getSourceChapter(threadId, chapterNumber)?.title ?? null;
    return this.mapBookmark(row, chapterNumber, title);
  }

  /** Delete a bookmark, scoped by threadId for safety. */
  deleteBookmark(threadId: string, id: string): void {
    const db = getDb();
    db.delete(bookmarks)
      .where(and(eq(bookmarks.id, id), eq(bookmarks.threadId, threadId)))
      .run();
  }

  /** Map a raw bookmarks row to the renderer-facing `Bookmark` shape. */
  private mapBookmark(
    row: (typeof bookmarks)["$inferSelect"],
    chapterNumber: number,
    title: string | null,
  ): Bookmark {
    let anchor: BookmarkAnchor | null = null;
    if (row.anchor) {
      try {
        anchor = JSON.parse(row.anchor) as BookmarkAnchor;
      } catch {
        anchor = null;
      }
    }
    return {
      id: row.id,
      chapterNumber,
      title,
      anchor,
      label: row.label,
      note: row.note,
      createdAt: row.createdAt,
    };
  }

  // --- read position ------------------------------------------------------

  /** Last-read chapter for interrupt recovery (null if never read). */
  getLastReadChapterNumber(threadId: string): number | null {
    return this.getEntertainmentConfig(threadId)?.lastReadChapterNumber ?? null;
  }

  /** Persist the reader's current chapter for resume-on-reopen. */
  setLastReadChapterNumber(threadId: string, chapterNumber: number): void {
    const db = getDb();
    db.update(entertainmentConfigs)
      .set({
        lastReadChapterNumber: chapterNumber,
        updatedAt: sql`(datetime('now'))`,
      })
      .where(eq(entertainmentConfigs.threadId, threadId))
      .run();
  }

  /**
   * Final chapter number of the book (null = unknown → assume the next chapter
   * exists). Distinct from lastReadChapterNumber (resume spot).
   */
  getFinalChapterNumber(threadId: string): number | null {
    return this.getEntertainmentConfig(threadId)?.finalChapterNumber ?? null;
  }

  // --- live reader cursor (in-memory, volatile) ----------------------------
  // A mirror of the renderer's (activeThreadId, currentChapterNumber) pair,
  // pushed via PUT /entertainment/reader-cursor by the reader component. This
  // is the Job-Type-1 surface: a LIVE "which thread + chapter is the reader
  // showing right now" pointer, held in memory so workers (Job Type 2) can
  // read it without a DB trip and without going through the merged reader view.
  //
  // Distinct from `lastReadChapterNumber` (the DB-persisted per-thread RECOVERY
  // value resumed on reopen): the cursor is a single volatile cross-thread
  // pointer that is null the moment nothing is open. Lost on main-process
  // restart, but the renderer re-pushes on its next mount/navigation, so it
  // self-heals within one render — the right contract for a live signal.
  private readerCursor: { threadId: string; chapterNumber: number } | null =
    null;

  /** The thread + chapter the reader is currently showing, or null when no
   *  thread is open. In-memory only (not persisted); for workers to poll. */
  getReaderCursor(): { threadId: string; chapterNumber: number } | null {
    return this.readerCursor;
  }

  /** Set or clear the live reader cursor. Called only by the reader-cursor
   *  REST route; null clears it (no thread open). */
  setReaderCursor(
    cursor: { threadId: string; chapterNumber: number } | null,
  ): void {
    this.readerCursor = cursor;
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

export const entertainmentFrontendService = new EntertainmentFrontendService();
