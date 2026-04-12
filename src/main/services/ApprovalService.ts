import log from "electron-log/main";

const logger = log.scope("ApprovalService");

type ApprovalDecision = "approved" | "rejected";

interface PendingApproval {
  resolve: (decision: ApprovalDecision) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Singleton service that manages pending plan approval requests.
 *
 * The worker calls `request(planId)` which returns a Promise that blocks
 * until the renderer sends a decision via IPC. The ApprovalBridge calls
 * `resolve(planId, decision)` to fulfill the Promise.
 */
export class ApprovalService {
  private static instance: ApprovalService | null = null;
  private pending = new Map<string, PendingApproval>();
  private readonly defaultTimeoutMs = 5 * 60 * 1000; // 5 minutes

  private constructor() {}

  static getInstance(): ApprovalService {
    if (!ApprovalService.instance) {
      ApprovalService.instance = new ApprovalService();
    }
    return ApprovalService.instance;
  }

  static destroyInstance(): void {
    if (ApprovalService.instance) {
      ApprovalService.instance.rejectAll("Service destroyed");
      ApprovalService.instance = null;
    }
  }

  /**
   * Request approval for a plan. The worker awaits the returned Promise.
   * Resolves when the user approves or rejects via IPC.
   * Rejects on timeout or if the service is cleaned up.
   */
  request(planId: string, timeoutMs?: number): Promise<ApprovalDecision> {
    const timeout = timeoutMs ?? this.defaultTimeoutMs;

    return new Promise<ApprovalDecision>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(planId);
        reject(new Error(`Approval request for "${planId}" timed out after ${timeout}ms`));
      }, timeout);

      this.pending.set(planId, { resolve, reject, timer });

      logger.info("Approval requested", { planId, timeoutMs: timeout });
    });
  }

  /**
   * Resolve a pending approval. Called by ApprovalBridge when the
   * renderer sends a decision via IPC.
   */
  resolve(planId: string, decision: ApprovalDecision): void {
    const pending = this.pending.get(planId);
    if (!pending) {
      logger.warn("No pending approval found", { planId });
      return;
    }

    clearTimeout(pending.timer);
    this.pending.delete(planId);
    pending.resolve(decision);

    logger.info("Approval resolved", { planId, decision });
  }

  /**
   * Reject all pending approvals. Used during app quit or session cleanup.
   */
  rejectAll(reason: string): void {
    const count = this.pending.size;
    for (const [_planId, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    this.pending.clear();

    if (count > 0) {
      logger.info("All approvals rejected", { reason, count });
    }
  }
}
