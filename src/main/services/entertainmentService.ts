import { getDb } from "@/db";
import {
  bookmarks,
  sourceChapters,
  rewrittenChapters,
  chapterOutlines,
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
import type {
  EntertainmentConfigRow,
  RewrittenChapterRow,
  SourceChapterRow,
} from "@/db/types";
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
   * Delete a source row (and any same-number rewrite row), scoped by
   * (threadId, chapterNumber). Used only by the dehydrate scheduler's
   * `FinalChapterError` path to remove the phantom row for a chapter that
   * turned out not to exist (the advance path couldn't find a next chapter →
   * the previous chapter was the last). Cascade-safe and idempotent.
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
    db.delete(rewrittenChapters)
      .where(
        and(
          eq(rewrittenChapters.threadId, threadId),
          eq(rewrittenChapters.chapterNumber, chapterNumber),
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
   * `chapterNumber` is the REWRITE OUTPUT's sequential number (reader spine).
   * `sourceChapterStart/End` record which source chapters this output covers:
   * 1:1 for pipelines ②/③ (both equal `chapterNumber`); a co-writing window
   * range for pipeline ①. Optional — older call sites that omit them leave the
   * columns NULL.
   */
  insertRewrittenChapter(input: {
    threadId: string;
    chapterNumber: number;
    content?: string | null;
    sourceChapterStart?: number | null;
    sourceChapterEnd?: number | null;
    status: RewrittenChapterStatus;
  }): void {
    const db = getDb();
    db.insert(rewrittenChapters)
      .values({
        id: crypto.randomUUID(),
        threadId: input.threadId,
        chapterNumber: input.chapterNumber,
        content: input.content ?? null,
        ...(input.sourceChapterStart != null && {
          sourceChapterStart: input.sourceChapterStart,
        }),
        ...(input.sourceChapterEnd != null && {
          sourceChapterEnd: input.sourceChapterEnd,
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

  // --- chapter outlines (大纲) -------------------------------------------
  // 章节并写 phase 1: per-chapter outline + foreshadowing keywords + a
  // needsCrossWrite flag. Generated by the outliner agent right after a file
  // upload is ingested; the scheduler gates rewriting on `status` here.

  /** Insert an outline row (caller ensures it doesn't exist yet). */
  insertOutline(input: {
    threadId: string;
    chapterNumber: number;
    status: OutlineStatus;
  }): void {
    const db = getDb();
    db.insert(chapterOutlines)
      .values({
        id: crypto.randomUUID(),
        threadId: input.threadId,
        chapterNumber: input.chapterNumber,
        status: input.status,
      })
      .run();
  }

  /** Patch an outline row's mutable columns. */
  updateOutline(
    threadId: string,
    chapterNumber: number,
    patch: {
      outline?: string;
      foreshadowing?: string;
      needsCrossWrite?: boolean;
      status?: OutlineStatus;
    },
  ): void {
    const db = getDb();
    db.update(chapterOutlines)
      .set({ ...patch, updatedAt: sql`(datetime('now'))` })
      .where(
        and(
          eq(chapterOutlines.threadId, threadId),
          eq(chapterOutlines.chapterNumber, chapterNumber),
        ),
      )
      .run();
  }

  /** Outline row by chapter number (undefined if none). */
  getOutline(threadId: string, chapterNumber: number) {
    const db = getDb();
    return db
      .select()
      .from(chapterOutlines)
      .where(
        and(
          eq(chapterOutlines.threadId, threadId),
          eq(chapterOutlines.chapterNumber, chapterNumber),
        ),
      )
      .get();
  }

  /** All outline rows for the thread, ordered by chapterNumber. */
  listOutlines(threadId: string) {
    const db = getDb();
    return db
      .select()
      .from(chapterOutlines)
      .where(eq(chapterOutlines.threadId, threadId))
      .orderBy(asc(chapterOutlines.chapterNumber))
      .all();
  }

  /** Count of outline rows for the thread (liveness / progress check). */
  getOutlineCount(threadId: string): number {
    const db = getDb();
    const row = db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(chapterOutlines)
      .where(eq(chapterOutlines.threadId, threadId))
      .get();
    return row?.count ?? 0;
  }

  /**
   * Whether every source chapter for the thread has an `outlined` outline row.
   * A chapter counts as done ONLY with `status: "outlined"` — `outlining`,
   * `error`, `skipped`, or a missing row all mean "not done". This is the
   * true-completion check for the outline step (vs `getOutlineCount > 0`,
   * which is merely a liveness/has-started check). Used by the scheduler's
   * re-entrancy guard and the startup recovery scan.
   */
  isOutlineComplete(threadId: string): boolean {
    const sourceCount = this.listSourceChapters(threadId).length;
    if (sourceCount === 0) return true; // no chapters → vacuously complete
    const outlinedCount = this.countOutlinesByStatus(threadId, "outlined");
    return outlinedCount >= sourceCount;
  }

  /** Count of outline rows in a given status for the thread. */
  countOutlinesByStatus(threadId: string, status: OutlineStatus): number {
    const db = getDb();
    const row = db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(chapterOutlines)
      .where(
        and(
          eq(chapterOutlines.threadId, threadId),
          eq(chapterOutlines.status, status),
        ),
      )
      .get();
    return row?.count ?? 0;
  }

  // --- merged reader view -------------------------------------------------
  // After the 3-pipeline refactor the reader's SPINE is the REWRITE OUTPUT,
  // not the source chapter. One rewrite output may cover multiple source
  // chapters (pipeline ① co-writing window), so the reader iterates
  // `rewritten_chapters` rows (their `chapterNumber` = output sequential
  // number) and joins source/outline rows across the output's
  // `[sourceChapterStart, sourceChapterEnd]` range. For 1:1 pipelines (②/③)
  // the range is a single number equal to the output number, so the behaviour
  // is unchanged from before. Source chapters with no rewrite output yet are
  // NOT shown — the reader never rendered 原文 anyway; a not-yet-rewritten
  // output shows as `paused`/`stopped` via its `phase`, derived below.

  /**
   * Derive the source-chapter range a rewrite output covers. Falls back to the
   * output's own `chapterNumber` when the explicit range columns are NULL
   * (older rows pre-migration, or pipelines that never set them). Always
   * returns a closed `[start, end]` with start ≤ end.
   */
  private sourceRangeForOutput(r: RewrittenChapterRow): [number, number] {
    const start =
      r.sourceChapterStart != null ? r.sourceChapterStart : r.chapterNumber;
    const end =
      r.sourceChapterEnd != null ? r.sourceChapterEnd : r.chapterNumber;
    return [Math.min(start, end), Math.max(start, end)];
  }

  /**
   * Per-output pipeline progress, spine'd on `rewritten_chapters` (the reader's
   * unit). `chapterNumber` is the output's sequential number; source/outline
   * statuses are aggregated across the output's source range (worst-case wins:
   * any `fetching`/`outlining` in the range surfaces so the reader shows
   * progress; any `error` surfaces too). Title: the source chapter's title for
   * single-source outputs (②/③); a synthesized `「第N-M章」` for a window
   * spanning multiple source chapters (①); falls back to the first source
   * title if the range can't be resolved.
   */
  listChapterProgress(threadId: string): ChapterProgress[] {
    const outputs = this.listRewrittenChapters(threadId);
    if (outputs.length === 0) return [];
    const sourceByNum = new Map(
      this.listSourceChapters(threadId).map((s) => [s.chapterNumber, s]),
    );
    const outlineByNum = new Map(
      getDb()
        .select()
        .from(chapterOutlines)
        .where(eq(chapterOutlines.threadId, threadId))
        .all()
        .map((o) => [o.chapterNumber, o]),
    );
    return outputs.map((r) => {
      const [start, end] = this.sourceRangeForOutput(r);
      let sourceStatus: SourceChapterStatus | null = null;
      let outlineStatus: OutlineStatus | null = null;
      for (let n = start; n <= end; n++) {
        const s = sourceByNum.get(n);
        if (s) sourceStatus = s.status; // last wins; range is contiguous
        const o = outlineByNum.get(n);
        if (o?.status === "outlining") outlineStatus = "outlining"; // worst-case
      }
      const title = this.outputTitle(start, end, sourceByNum);
      return {
        chapterNumber: r.chapterNumber,
        title,
        sourceStatus,
        rewriteStatus: r.status,
        outlineStatus,
      };
    });
  }

  /**
   * Single-output detail, keyed by the OUTPUT sequential number. Prose comes
   * from the rewrite row (only when `rewritten`); source/outline aggregated
   * across the output's range. `chapterNumber` echo is the output number.
   */
  getChapterDetail(threadId: string, chapterNumber: number): ChapterDetail {
    const r = this.getRewrittenChapter(threadId, chapterNumber);
    if (!r) {
      // No output row yet — synthesize null statuses so the reader's phase
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
    const [start, end] = this.sourceRangeForOutput(r);
    const sourceByNum = new Map(
      this.listSourceChapters(threadId).map((s) => [s.chapterNumber, s]),
    );
    const outlineByNum = new Map(
      getDb()
        .select()
        .from(chapterOutlines)
        .where(eq(chapterOutlines.threadId, threadId))
        .all()
        .map((o) => [o.chapterNumber, o]),
    );
    let sourceStatus: SourceChapterStatus | null = null;
    let outlineStatus: OutlineStatus | null = null;
    for (let n = start; n <= end; n++) {
      const s = sourceByNum.get(n);
      if (s) sourceStatus = s.status;
      const o = outlineByNum.get(n);
      if (o?.status === "outlining") outlineStatus = "outlining";
    }
    return {
      chapterNumber: r.chapterNumber,
      title: this.outputTitle(start, end, sourceByNum),
      sourceStatus,
      rewriteStatus: r.status,
      outlineStatus,
      // Only expose rewritten prose to the reader (never 原文).
      content: r.status === "rewritten" ? r.content : null,
    };
  }

  /**
   * Title for a reader-facing output. Single-source (②/③): the source row's
   * title. Multi-source window (①): synthesized `「第N-M章」`. Falls back to
   * `null` when no source row resolves.
   */
  private outputTitle(
    start: number,
    end: number,
    sourceByNum: Map<number, SourceChapterRow>,
  ): string | null {
    if (start === end) {
      return sourceByNum.get(start)?.title ?? null;
    }
    // Multi-source window: synthesize a range title only when the bounds are
    // real source chapter numbers; else fall back to the first title.
    const firstTitle = sourceByNum.get(start)?.title;
    return `第${start}-${end}章${firstTitle ? ` ${firstTitle}` : ""}`;
  }

  /**
   * Rewritten OUTPUTS in [from, to] (either bound optional, by OUTPUT number),
   * ordered asc — the export/download source. Only `rewritten` rows (with
   * prose); title derived per-output via the same source-range logic as
   * `listChapterProgress` (single source → its title; window → `第N-M章`).
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
      const [start, end] = this.sourceRangeForOutput(r);
      out.push({
        chapterNumber: r.chapterNumber,
        title: this.outputTitle(start, end, sourceByNum),
        content: r.content ?? "",
      });
    }
    return out;
  }

  // --- bookmarks ----------------------------------------------------------

  /**
   * All bookmarks for the thread, newest first, with `chapterNumber` + `title`
   * joined from the rewrite OUTPUT (the reader lists/jumps by the output's
   * sequential number, never the DB id). Title derives per-output via the same
   * source-range logic as `listChapterProgress`.
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
      const [start, end] = this.sourceRangeForOutput(rewrite);
      out.push(
        this.mapBookmark(
          row,
          rewrite.chapterNumber,
          this.outputTitle(start, end, sourceByNum),
        ),
      );
    }
    return out;
  }

  /**
   * Save a reading spot. `chapterId` is resolved from (threadId, chapterNumber)
   * where `chapterNumber` is the OUTPUT sequential number; throws if no rewrite
   * row exists yet (the reader only bookmarks ready outputs, so this is
   * defensive). `label` and `note` are currently left null (auto-label is
   * rendered client-side).
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
    const sourceByNum = new Map(
      this.listSourceChapters(threadId).map((s) => [s.chapterNumber, s]),
    );
    const [start, end] = this.sourceRangeForOutput(rewrite);
    const title = this.outputTitle(start, end, sourceByNum);
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
