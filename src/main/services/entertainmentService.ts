import { getDb } from "@/db";
import {
  bookmarks,
  sourceChapters,
  rewrittenChapters,
  entertainmentConfigs,
  threads,
} from "@/db/schema";
import type {
  Bookmark,
  BookmarkAnchor,
  ChapterDetail,
  ChapterProgress,
  EntertainmentConfig,
  OutlineStatus,
  RewrittenChapterStatus,
  SourceChapterStatus,
} from "@shared";
import { EntertainmentConfigSchema } from "@shared";
import type { EntertainmentConfigRow } from "@/db/types";
import { threadPersistenceService } from "./threadPersistenceService";
import { i18n } from "@/i18n";
import { eventBus } from "@/utils/eventBus";
import { and, asc, desc, eq, sql } from "drizzle-orm";
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
    outline?: string;
    foreshadowing?: string;
    outlineStatus?: OutlineStatus;
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
        ...(input.outline != null && { outline: input.outline }),
        ...(input.foreshadowing != null && {
          foreshadowing: input.foreshadowing,
        }),
        ...(input.outlineStatus != null && {
          outlineStatus: input.outlineStatus,
        }),
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
      outline?: string;
      foreshadowing?: string;
      outlineStatus?: OutlineStatus;
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
   * Delete a source row by (threadId, chapterNumber). The rewritten_chapters
   * FK (sourceChapterId ON DELETE CASCADE) removes the corresponding rewrite
   * row automatically. Used by: (a) the internet fetcher's FinalChapterError
   * path (phantom row removal), (b) the outliner's carry-forward (deletes the
   * last chapter to re-merge it with the next chunk). Cascade-safe, idempotent.
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

  /**
   * Insert a rewrite row (caller ensures it doesn't exist yet).
   * `chapterNumber` mirrors the source chapter's number (strict 1:1).
   * `sourceChapterId` is the FK to the source row — ON DELETE CASCADE ensures
   * deleting a source row removes its rewrite too.
   */
  insertRewrittenChapter(input: {
    threadId: string;
    chapterNumber: number;
    content?: string | null;
    sourceChapterId?: string | null;
    status: RewrittenChapterStatus;
  }): void {
    const db = getDb();
    db.insert(rewrittenChapters)
      .values({
        id: crypto.randomUUID(),
        threadId: input.threadId,
        chapterNumber: input.chapterNumber,
        content: input.content ?? null,
        ...(input.sourceChapterId != null && {
          sourceChapterId: input.sourceChapterId,
        }),
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

  // --- outline data (co-located on source_chapters) ---------------------
  // After the table merge, outline/foreshadowing/outlineStatus live ON the
  // source row. The outliner (file-novel pipeline) populates them during the
  // outline pass. These accessors read/write source chapters' outline columns.

  /**
   * Whether every source chapter for the thread has outlineStatus "outlined".
   * A chapter counts as done ONLY with `outlineStatus: "outlined"` — "pending"
   * or "error" mean "not done". This is the true-completion check for the
   * outline step. Used by the scheduler's re-entrancy guard + startup recovery.
   */
  isOutlineComplete(threadId: string): boolean {
    const sources = this.listSourceChapters(threadId);
    if (sources.length === 0) return true; // no chapters → vacuously complete
    return sources.every((s) => s.outlineStatus === "outlined");
  }

  /** Count of source chapters with a given outline status for the thread. */
  countSourceByOutlineStatus(threadId: string, status: OutlineStatus): number {
    return this.listSourceChapters(threadId).filter(
      (s) => s.outlineStatus === status,
    ).length;
  }

  // --- merged reader view -------------------------------------------------
  // The reader's SPINE is `rewritten_chapters`, in strict 1:1 with
  // `source_chapters` (same chapterNumber). Each rewrite row joins its source
  // row directly — title, sourceStatus, and outlineStatus all come from the
  // source row at the same number. No range aggregation: one rewrite = one
  // source. Source chapters with no rewrite row yet are NOT shown (the reader
  // never rendered 原文); a not-yet-rewritten chapter shows as `paused`/
  // `stopped` via its `phase`.

  /**
   * Per-chapter pipeline progress, spine'd on `rewritten_chapters` (1:1 with
   * source). title/sourceStatus/outlineStatus come from the source row at the
   * same chapterNumber.
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
        outlineStatus: s?.outlineStatus ?? null,
      };
    });
  }

  /**
   * Single-chapter detail (1:1 keyed). Prose comes from the rewrite row (only
   * when `rewritten`); title/sourceStatus/outlineStatus from the source row at
   * the same number.
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
        outlineStatus: null,
        content: null,
      };
    }
    const s = this.getSourceChapter(threadId, chapterNumber);
    return {
      chapterNumber: r.chapterNumber,
      title: s?.title ?? null,
      sourceStatus: s?.status ?? null,
      rewriteStatus: r.status,
      outlineStatus: s?.outlineStatus ?? null,
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
   * exists). Set upfront: files at ingest (parsed count), the internet stub at
   * setup (hard-wired 40). Distinct from lastReadChapterNumber (resume spot).
   */
  getFinalChapterNumber(threadId: string): number | null {
    return this.getEntertainmentConfig(threadId)?.finalChapterNumber ?? null;
  }

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

  /**
   * Highest committed source chapterNumber for the thread, or 0 if none. The
   * outliner derives `nextChapterNumber = maxSourceChapterNumber + 1` from this
   * (read-time derivation, no counter column) so chapter numbering is gap-free
   * and survives crash-resume: whatever chapters already landed in
   * `source_chapters` define where the next one continues.
   */
  maxSourceChapterNumber(threadId: string): number {
    const db = getDb();
    const row = db
      .select({
        max: sql<number>`cast(max(${sourceChapters.chapterNumber}) as integer)`,
      })
      .from(sourceChapters)
      .where(eq(sourceChapters.threadId, threadId))
      .get();
    return row?.max ?? 0;
  }

  /**
   * All rewrite OUTPUT rows for the thread, ordered by `chapterNumber` (the
   * REWRITE OUTPUT sequential number — the reader's spine key, NOT a source
   * chapter number after the 3-pipeline refactor). Used by the read-side spine
   * (`listChapterProgress`/`getChapterDetail`) and by pipeline ①'s co-write
   * windowing to find the next free output number.
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

  /**
   * Highest rewrite OUTPUT sequential number for the thread, or 0 if none.
   * Pipeline ① derives `nextOutputNumber = maxRewrittenChapterNumber + 1` from
   * this so output numbering is gap-free and survives crash-resume (whatever
   * co-write windows already landed in `rewritten_chapters` define where the
   * next output continues). Note this is the OUTPUT number, not a source
   * chapter number — for 1:1 pipelines (②/③) they coincide.
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

  // --- raw novel text (file-upload only) -----------------------------------
  // The full decoded novel text for a file upload, held ONLY for the duration of
  // the outline run so the chunk loop can re-read it on crash-resume without
  // touching the (possibly moved/deleted) source file. Each accessor selects a
  // single column so the multi-MB blob never loads on hot config reads.

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

  /** Drop the raw blob (frees DB space once the outline run is complete). */
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

  /**
   * How far the outliner has consumed `rawText` (character offset). Persisted
   * inside the `outputChapters` tool's execute after each round, so every round
   * boundary is a recovery point. 0 on a fresh upload.
   */
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

  /** Persist the consumed offset (recovery checkpoint after each round). */
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

  /**
   * Reconstruct + re-validate the stored config into a typed
   * `EntertainmentConfig`. The dehydrate scheduler uses this to feed the real,
   * persisted wizard values (novel origin + options) to the acquisition/rewrite
   * stubs. Re-validation via `EntertainmentConfigSchema.safeParse` is defensive
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
