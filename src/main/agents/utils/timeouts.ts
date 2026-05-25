import type { TimeoutConfiguration } from "ai";

export const TIMEOUTS = {
  /** Interactive chat, summaries — user is waiting */
  chat: { stepMs: 300_000, chunkMs: 120_000 } satisfies TimeoutConfiguration,
  /** Planning agents — single-step tool calls */
  planning: {
    stepMs: 300_000,
    chunkMs: 120_000,
  } satisfies TimeoutConfiguration,
  /** Action execution — multi-step browser automation loops */
  actionExecution: {
    stepMs: 480_000,
    chunkMs: 120_000,
  } satisfies TimeoutConfiguration,
} as const;

export function isTimeoutError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes("timeout") ||
      msg.includes("timed out") ||
      msg.includes("aborted") ||
      error.name === "TimeoutError" ||
      error.name === "AbortError"
    );
  }
  return false;
}
