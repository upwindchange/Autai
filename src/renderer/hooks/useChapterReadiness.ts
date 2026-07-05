import { useEffect } from "react";
import type { ChapterDetail } from "@shared";
import { useChaptersStore } from "@/stores/chaptersStore";

const POLL_INTERVAL_MS = 1500;
// After this long without readiness, retrigger the whole ensure+poll cycle.
const RETRY_DEADLINE_MS = 10 * 60 * 1000;

// Terminal = no more work will happen, so polling must stop. "rewritten" is the
// success terminal; an "error" status (rewrite OR source) is the failure
// terminal — a source-errored internet chapter never gets a rewrite row, so
// both columns must count. A transient fetch failure yields `undefined` and is
// NOT terminal (still in flight); the store surfaces those separately.
const isTerminal = (detail: ChapterDetail | undefined): boolean =>
  !!detail &&
  (detail.rewriteStatus === "rewritten" ||
    detail.rewriteStatus === "error" ||
    detail.sourceStatus === "error");

/**
 * Drive a chapter to a terminal state (rewritten, or errored) for the active
 * thread.
 *
 *   1. Poll once. If terminal → done (success or failure — neither needs more
 *      polling).
 *   2. Kick the worker for chapter N (idempotent: starts if absent, re-targets
 *      if busy elsewhere — handles Next and TOC jumps far ahead).
 *   3. Poll every POLL_INTERVAL_MS, re-checking worker liveness each tick
 *      (re-ensure if it died or drifted off N) until terminal or deadline.
 *   4. On timeout (still not terminal) → retrigger from step 1 (self-recover: a
 *      crashed worker is absent, so a fresh one is started). A chapter that has
 *      terminally errored is NOT retriggered — the user re-enqueues it via
 *      "Redo failed", which the scheduler's retryFailed path handles.
 *
 * The DB status columns are truth; this hook only re-reads them and guarantees
 * liveness. No SSE, no event races. Re-runs (cleanly) when the reader moves.
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
    let latest: ChapterDetail | undefined;

    const attempt = async (): Promise<void> => {
      // eslint-disable-next-line no-console
      console.debug("[ent:readiness] start", { threadId, chapterNumber });
      // 1. Poll once.
      latest = await store().loadChapterDetail(threadId, chapterNumber);
      if (cancelled || isTerminal(latest)) {
        if (isTerminal(latest))
          // eslint-disable-next-line no-console
          console.debug("[ent:readiness] terminal (initial poll)", {
            chapterNumber,
            rewriteStatus: latest?.rewriteStatus,
            sourceStatus: latest?.sourceStatus,
          });
        return;
      }
      // eslint-disable-next-line no-console
      console.debug("[ent:readiness] not ready — kicking worker", {
        chapterNumber,
        sourceStatus: latest?.sourceStatus,
        rewriteStatus: latest?.rewriteStatus,
      });

      // 2. Kick the worker for this chapter (start/re-target).
      await store().ensureWorker(threadId, chapterNumber);
      if (cancelled) return;

      // 3. Poll + liveness until ready or deadline.
      const deadline = Date.now() + RETRY_DEADLINE_MS;
      await new Promise<void>((resolve) => {
        timer = setInterval(async () => {
          if (cancelled) {
            resolve();
            return;
          }
          latest = await store().loadChapterDetail(threadId, chapterNumber);
          if (isTerminal(latest)) {
            // eslint-disable-next-line no-console
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
          // Self-heal: re-ensure if the worker died or drifted off this chapter.
          const info = await store().queryWorker(threadId);
          if (!info.active || info.target !== chapterNumber) {
            // eslint-disable-next-line no-console
            console.debug("[ent:readiness] re-ensure worker", {
              chapterNumber,
              active: info.active,
              target: info.target,
            });
            await store().ensureWorker(threadId, chapterNumber);
          }
          if (Date.now() > deadline) {
            if (timer) clearInterval(timer);
            timer = null;
            resolve();
          }
        }, POLL_INTERVAL_MS);
      });
      if (cancelled) return;

      // 4. Timeout retrigger if still not terminal. A terminally errored chapter
      //    is not retriggered — it needs "Redo failed", not more polling.
      if (!isTerminal(latest)) {
        // eslint-disable-next-line no-console
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
