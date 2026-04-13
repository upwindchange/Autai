import log from "electron-log/main";

const logger = log.scope("HitlService");

interface PendingHitlRequest {
  resolve: (response: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Singleton service that manages pending human-in-the-loop requests.
 *
 * The worker calls `request(id)` which returns a Promise that blocks
 * until the renderer sends a response via IPC. The HitlBridge calls
 * `respond(id, response)` to fulfill the Promise.
 */
export class HitlService {
  private static instance: HitlService | null = null;
  private pending = new Map<string, PendingHitlRequest>();
  private readonly defaultTimeoutMs = 5 * 60 * 1000; // 5 minutes

  private constructor() {}

  static getInstance(): HitlService {
    if (!HitlService.instance) {
      HitlService.instance = new HitlService();
    }
    return HitlService.instance;
  }

  static destroyInstance(): void {
    if (HitlService.instance) {
      HitlService.instance.rejectAll("Service destroyed");
      HitlService.instance = null;
    }
  }

  /**
   * Request a human-in-the-loop response. The worker awaits the returned Promise.
   * Resolves when the user responds via IPC.
   * Rejects on timeout or if the service is cleaned up.
   */
  request<T = unknown>(id: string, timeoutMs?: number): Promise<T> {
    const timeout = timeoutMs ?? this.defaultTimeoutMs;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`HITL request for "${id}" timed out after ${timeout}ms`));
      }, timeout);

      this.pending.set(id, { resolve: resolve as (response: unknown) => void, reject, timer });

      logger.info("HITL requested", { id, timeoutMs: timeout });
    });
  }

  /**
   * Respond to a pending HITL request. Called by HitlBridge when the
   * renderer sends a response via IPC.
   */
  respond(id: string, response: unknown): void {
    const pending = this.pending.get(id);
    if (!pending) {
      logger.warn("No pending HITL request found", { id });
      return;
    }

    clearTimeout(pending.timer);
    this.pending.delete(id);
    pending.resolve(response);

    logger.info("HITL responded", { id, response });
  }

  /**
   * Reject all pending requests. Used during app quit or session cleanup.
   */
  rejectAll(reason: string): void {
    const count = this.pending.size;
    for (const [_id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    this.pending.clear();

    if (count > 0) {
      logger.info("All HITL requests rejected", { reason, count });
    }
  }
}
