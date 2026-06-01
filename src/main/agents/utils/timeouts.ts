import type { TimeoutConfiguration } from "ai";
import { settingsService } from "@/services/settingsService";

/** Default timeout values (in seconds). Converted to ms at runtime. */
const DEFAULT_TIMEOUTS = {
  /** response (chat + planning) */
  response: 300,
  /** action execution */
  action: 480,
  /** hitl agent */
  interactive: 600,
  /** streaming chunk (shared) */
  streaming: 120,
} as const;

/**
 * Build the timeout configuration from user settings.
 * Values are stored as seconds in settings and converted to ms here.
 */
export function getTimeouts(): {
  chat: TimeoutConfiguration;
  planning: TimeoutConfiguration;
  actionExecution: TimeoutConfiguration;
  hitlAgent: TimeoutConfiguration;
} {
  const t = settingsService.settings.timeouts ?? DEFAULT_TIMEOUTS;

  const responseMs = t.response * 1000;
  const actionMs = t.action * 1000;
  const interactiveMs = t.interactive * 1000;
  const streamingMs = t.streaming * 1000;

  return {
    /** Interactive chat, summaries — user is waiting */
    chat: { stepMs: responseMs, chunkMs: streamingMs },
    /** Planning agents — single-step tool calls */
    planning: { stepMs: responseMs, chunkMs: streamingMs },
    /** Action execution — multi-step browser automation loops */
    actionExecution: { stepMs: actionMs, chunkMs: streamingMs },
    /** HITL agent — user interaction sub-agent (includes user wait time) */
    hitlAgent: { stepMs: interactiveMs, chunkMs: streamingMs },
  };
}

/** Convenience alias — same as getTimeouts() for backward compatibility */
export const TIMEOUTS = {
  get chat() {
    return getTimeouts().chat;
  },
  get planning() {
    return getTimeouts().planning;
  },
  get actionExecution() {
    return getTimeouts().actionExecution;
  },
  get hitlAgent() {
    return getTimeouts().hitlAgent;
  },
};

export function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") return true;
  if (error instanceof Error && error.name === "AbortError") return true;
  return false;
}

export function isTimeoutError(error: unknown): boolean {
  if (isAbortError(error)) return false;
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes("timeout") ||
      msg.includes("timed out") ||
      error.name === "TimeoutError"
    );
  }
  return false;
}
