import { useEffect } from "react";
import type { ChapterDetail, ChapterStatus } from "@shared";
import { useChaptersStore } from "@/stores/chaptersStore";

const POLL_INTERVAL_MS = 1500;
// After this long without readiness, retrigger the whole poll cycle.
const RETRY_DEADLINE_MS = 10 * 60 * 1000;

// The chapter detail carried by the store's `loadChapterDetail` — the backend
// appends a derived `status` (phase + pipeline-aware message) to each chapter.
type ChapterDetailWithStatus = ChapterDetail & { status: ChapterStatus };

// Terminal = no more work will happen, so polling must stop. "rewritten" is the
// success terminal; an "error" status (rewrite OR source) is the failure
// terminal — a source-errored internet chapter never gets a rewrite row, so
// both columns must count. A transient fetch failure yields `undefined` and is
// NOT terminal (still in flight); the store surfaces those separately.
const isTerminal = (detail: ChapterDetailWithStatus | undefined): boolean =>
  !!detail &&
  (detail.rewriteStatus === "rewritten" ||
    detail.rewriteStatus === "to_be_continued" ||
    detail.rewriteStatus === "error" ||
    detail.sourceStatus === "error");

/**
 * Drive a chapter to a terminal state (rewritten, or errored) for the active
 * thread.
 *
 *   1. Poll once. If terminal → done (success or failure — neither needs more
 *      polling).
 *   2. Poll every POLL_INTERVAL_MS until terminal or deadline.
 *   3. On timeout (still not terminal) → retrigger from step 1. A chapter that
 *      has terminally errored is NOT retriggered — the user re-enqueues it via
 *      "Redo failed".
 *
 * The DB status columns are truth; this hook only re-reads them. No SSE, no
 * event races. Re-runs (cleanly) when the reader moves.
 */
export function useChapterReadiness(
  threadId: string | null,
  chapterNumber: number | null,
): void {
  useEffect(() => {
    if (!threadId || chapterNumber == null) return;
    const store = useChaptersStore.getState;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    let latest: ChapterDetailWithStatus | undefined;

    const attempt = async (): Promise<void> => {
      console.debug("[ent:readiness] start", { threadId, chapterNumber });
      // 1. Poll once.
      latest = await store().loadChapterDetail(threadId, chapterNumber);
      if (cancelled || isTerminal(latest)) {
        if (isTerminal(latest))
          console.debug("[ent:readiness] terminal (initial poll)", {
            chapterNumber,
            rewriteStatus: latest?.rewriteStatus,
            sourceStatus: latest?.sourceStatus,
          });
        return;
      }

      console.debug("[ent:readiness] not ready — polling", {
        chapterNumber,
        sourceStatus: latest?.sourceStatus,
        rewriteStatus: latest?.rewriteStatus,
      });

      // 2. Poll until ready or deadline.
      const deadline = Date.now() + RETRY_DEADLINE_MS;
      await new Promise<void>((resolve) => {
        timer = setInterval(async () => {
          if (cancelled) {
            resolve();
            return;
          }
          latest = await store().loadChapterDetail(threadId, chapterNumber);
          if (isTerminal(latest)) {
            console.debug("[ent:readiness] terminal", {
              chapterNumber,
              rewriteStatus: latest?.rewriteStatus,
              sourceStatus: latest?.sourceStatus,
            });
            if (timer) clearInterval(timer);
            timer = null;
            resolve();
            return;
          }
          if (Date.now() > deadline) {
            if (timer) clearInterval(timer);
            timer = null;
            resolve();
          }
        }, POLL_INTERVAL_MS);
      });
      if (cancelled) return;

      // 3. Timeout retrigger if still not terminal. A terminally errored chapter
      //    is not retriggered — it needs "Redo failed", not more polling.
      if (!isTerminal(latest)) {
        console.warn("[ent:readiness] timeout — retriggering", {
          threadId,
          chapterNumber,
        });
        await attempt();
      }
    };

    void attempt();
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [threadId, chapterNumber]);
}
