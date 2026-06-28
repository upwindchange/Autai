import { useEffect } from "react";
import type { ChapterDetail } from "@shared";
import { useChaptersStore } from "@/stores/chaptersStore";

const POLL_INTERVAL_MS = 1500;
// After this long without readiness, retrigger the whole ensure+poll cycle.
const RETRY_DEADLINE_MS = 10 * 60 * 1000;

const isReady = (detail: ChapterDetail | undefined) =>
  detail?.rewriteStatus === "rewritten";

/**
 * Drive a chapter to readiness (rewritten prose) for the active thread.
 *
 *   1. Poll once. If rewritten → done.
 *   2. Kick the worker for chapter N (idempotent: starts if absent, re-targets
 *      if busy elsewhere — handles Next and TOC jumps far ahead).
 *   3. Poll every POLL_INTERVAL_MS, re-checking worker liveness each tick
 *      (re-ensure if it died or drifted off N) until rewritten or deadline.
 *   4. On timeout (still not ready) → retrigger from step 1 (self-recover: a
 *      crashed worker is absent, so a fresh one is started).
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
      if (cancelled || isReady(latest)) {
        if (isReady(latest))
          // eslint-disable-next-line no-console
          console.debug("[ent:readiness] ready (initial poll)", {
            chapterNumber,
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
          if (isReady(latest)) {
            // eslint-disable-next-line no-console
            console.debug("[ent:readiness] ready", { chapterNumber });
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

      // 4. Timeout retrigger if still not ready.
      if (!isReady(latest)) {
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
