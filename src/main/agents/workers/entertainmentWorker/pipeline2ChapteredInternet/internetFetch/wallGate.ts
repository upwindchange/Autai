/**
 * Wall gate — orchestrator-side HITL for chaptered internet fetch walls.
 *
 * When `fetchInternetChapter` hits a wall (login / paywall / captcha / age
 * gate) it calls `requestWallHelp` BEFORE blocking the site: the reader gets
 * an `entertainment:wallPrompt` event and may step in manually in the split
 * view (the crawl session shares the default cookie jar, so the login
 * persists), retry on the same site, or skip (only then does the site get
 * blacklisted and the ladder rotate).
 *
 * Deliberately NOT an AI-SDK tool (HitlTools are chat tools rendered inside
 * chat messages): this is a direct request/response between the fetch
 * orchestrator and the reader, reusing `HitlService` for the pending-response
 * plumbing and `POST /hitl/respond` for the answer channel.
 *
 * Reader-focus rule: with no reader focused on the thread there is nobody to
 * answer the card (e.g. walls during the wizard prefetch), so the gate
 * auto-rejects without ever parking the runner.
 */
import log from "electron-log/main";
import {
  HitlService,
  SessionTabService,
  entertainmentFrontendService,
} from "@/services";
import type { WallPromptPayload } from "@shared/events";
import { eventBus } from "@/utils/eventBus";

const logger = log.scope("Dehydrate:WallGate");

/**
 * "Wait until answered" — HitlService would otherwise reject after its 5-min
 * default. Max 32-bit setTimeout value ≈ 24.8 days; the runner's abort signal
 * is the real bound (thread switch / Stop tears everything down).
 */
const WAIT_FOREVER_MS = 2_147_483_647;

/** One live prompt per thread (dynamic, deleted on clear) — the reader shows
 * at most one card. */
const activePrompts = new Map<string, WallPromptPayload>();

/** The thread's current wall prompt, or null — surfaced for REST recovery. */
export function getActiveWallPrompt(threadId: string): WallPromptPayload | null {
  return activePrompts.get(threadId) ?? null;
}

/**
 * Dismiss any parked card for the thread (teardown: stop / thread switch).
 * The pending HitlService request is rejected separately by the abort signal;
 * this only clears the visible state for a renderer that reloads.
 */
export function clearWallPrompt(threadId: string): void {
  const prompt = activePrompts.get(threadId);
  if (!prompt) return;
  activePrompts.delete(threadId);
  eventBus.emitEvent("entertainment:wallPrompt", { ...prompt, state: "cleared" });
}

/**
 * Ask the reader to pass a wall. Resolves "resolved" when the user finished
 * stepping in AND the post-step probe no longer detects the wall, "rejected"
 * when the user skipped or gave up, no reader was focused on the thread, or
 * the fetch was aborted.
 */
export async function requestWallHelp(params: {
  threadId: string;
  chapterNumber: number;
  sessionId: string;
  host: string;
  reason: string;
  signal?: AbortSignal;
  /** Re-probe the landing after the user pressed Done (marker or null). */
  probeNow: () => Promise<string | null>;
}): Promise<"resolved" | "rejected"> {
  const { threadId, chapterNumber, sessionId, host, reason, signal, probeNow } =
    params;
  const hitl = HitlService.getInstance();

  // No reader focused on this thread ⇒ nobody can answer the card. Auto-reject
  // WITHOUT emitting a prompt so the runner is never parked unanswerably.
  const cursor = entertainmentFrontendService.getReaderCursor();
  if (!cursor || cursor.threadId !== threadId) {
    logger.warn("wall gate auto-rejected — no reader focus", {
      threadId,
      host,
      reason,
    });
    return "rejected";
  }

  // One id across the whole ask→step→probe loop: the payload the renderer
  // sees and the pending HitlService request must match so POST /hitl/respond
  // resolves the CURRENT request (also after a renderer reload). Date.now()
  // keeps distinct chapters distinct.
  const id = `wall-${threadId}-${chapterNumber}-${Date.now()}`;
  const askPrompt: WallPromptPayload = {
    id,
    threadId,
    chapterNumber,
    host,
    reason,
    state: "ask",
  };
  const steppingPrompt: WallPromptPayload = {
    ...askPrompt,
    state: "stepping",
  };
  let passed = false;
  try {
    while (true) {
      activePrompts.set(threadId, askPrompt);
      eventBus.emitEvent("entertainment:wallPrompt", askPrompt);
      const ask = await hitl.request<{ action: "stepIn" | "reject" }>(
        id,
        WAIT_FOREVER_MS,
        signal,
      );
      if (ask.action === "reject") break;

      // Step-in: re-assert the crawl session as the active split-view session
      // so the tab the user must work on is the one on screen, then wait for
      // Done / Give up.
      await SessionTabService.getInstance().activateSession(sessionId);
      eventBus.emitEvent("splitview:activate", null);
      activePrompts.set(threadId, steppingPrompt);
      eventBus.emitEvent("entertainment:wallPrompt", steppingPrompt);
      const step = await hitl.request<{ action: "done" | "giveUp" }>(
        id,
        WAIT_FOREVER_MS,
        signal,
      );
      if (step.action === "giveUp") break;

      const marker = await probeNow();
      if (marker == null) {
        passed = true; // wall passed — same site is usable again
        break;
      }
      // Wall still up: loop back to `ask` so the user can retry or skip.
      logger.info("wall still present after step-in — re-asking", {
        threadId,
        host,
        marker,
      });
    }
  } catch (err) {
    // Abort (thread switch / Stop) or HitlService teardown — treat as skip.
    logger.info("wall gate ended without resolution", { threadId, host, err });
    clearWallPrompt(threadId);
    return "rejected";
  }
  clearWallPrompt(threadId);
  return passed ? "resolved" : "rejected";
}
